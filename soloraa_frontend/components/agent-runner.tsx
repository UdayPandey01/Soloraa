"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useShallow } from "zustand/react/shallow";
import {
    Play,
    Square,
    RotateCcw,
    ShieldCheck,
    ArrowRight,
    Lock,
    ExternalLink,
    TrendingUp,
    TrendingDown,
    Wallet,
} from "lucide-react";
import { useExecution, type StageId } from "@/lib/execution-store";
import { usePortfolio, type PortfolioReceipt } from "@/lib/portfolio-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { PipelineTrack } from "@/components/pipeline-track";
import { EventFeed } from "@/components/event-feed";
import { DelegationModal } from "@/components/delegation-modal";
import { type Agent } from "@/lib/agents";
import {
    delegateToBurner,
    sendMemoWithSigner,
    shortPubkey,
    shortSig,
    withdrawFromBurner,
} from "@/lib/devnet-tx";
import { CLUSTER } from "@/lib/solora";
import {
    getStrategy,
    SOL_USDC_REF,
    type CycleContext,
    type MetricCard,
    type StrategySummary,
    type Ticker,
} from "@/lib/strategies";
import { usePythPrice } from "@/lib/pyth-feed";

interface AgentRunnerProps {
    agent: Agent;
}

type ApprovalStatus =
    | "idle"
    | "signing"
    | "confirming"
    | "confirmed"
    | "failed";

interface DevnetReceipt {
    label: string;
    signature: string;
    explorerUrl: string;
    notionalUsdc: number;
    ts: number;
}

const DEFAULT_DELEGATION_SOL = 0.1;
const TX_FEE_LAMPORTS = 5_000;

const newEventId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

const STAGE_MS = {
    intent: 380,
    policy: 380,
    oracle: 420,
    build: 380,
    sign: 380,
    broadcast: 360,
    verify: 380,
} as const;
const CYCLE_GAP_MS = 5000;


export function AgentRunner({ agent }: AgentRunnerProps) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { publicKey, connected } = wallet;
    const { setVisible: setWalletModalVisible } = useWalletModal();
    const {
        run,
        start,
        appendEvent,
        setStage,
        resetStages,
        recordSuccess,
        markRejection,
        stop,
        reset,
    } = useExecution(
        useShallow((s) => ({
            run: s.run,
            start: s.start,
            appendEvent: s.appendEvent,
            setStage: s.setStage,
            resetStages: s.resetStages,
            recordSuccess: s.recordSuccess,
            markRejection: s.markRejection,
            stop: s.stop,
            reset: s.reset,
        }))
    );
    const upsertRunToPortfolio = usePortfolio((s) => s.upsertRun);

    const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
    const cancelRef = useRef(false);
    const loopOwnerRef = useRef(0);
    const burnerRef = useRef<Keypair | null>(null);
    const runIdRef = useRef<string | null>(null);
    const runStartedAtRef = useRef<number>(0);
    const approvalReceiptRef = useRef<DevnetReceipt | null>(null);
    const strategy = useMemo(() => getStrategy(agent.kind), [agent.kind]);
    const strategyStateRef = useRef<unknown>(strategy.init(DEFAULT_DELEGATION_SOL));

    const pyth = usePythPrice();
    const pythCtxRef = useRef<CycleContext>({
        livePrice: SOL_USDC_REF,
        confBps: 0,
        publishTimeMs: 0,
        isLive: false,
    });
    useEffect(() => {
        pythCtxRef.current = {
            livePrice: pyth.price ?? SOL_USDC_REF,
            confBps: pyth.confBps ?? 0,
            publishTimeMs: pyth.publishTimeMs ?? 0,
            isLive: pyth.isLive && pyth.price != null,
        };
    }, [pyth.price, pyth.confBps, pyth.publishTimeMs, pyth.isLive]);

    const [delegationOpen, setDelegationOpen] = useState(false);
    const [delegatedAmountSol, setDelegatedAmountSol] = useState(DEFAULT_DELEGATION_SOL);
    const [walletBalanceSol, setWalletBalanceSol] = useState<number | null>(null);
    const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("idle");
    const [approvalReceipt, setApprovalReceipt] = useState<DevnetReceipt | null>(null);
    const [approvalError, setApprovalError] = useState<string | undefined>();
    const [executionReceipts, setExecutionReceipts] = useState<DevnetReceipt[]>([]);
    const [strategyState, setStrategyState] = useState<unknown>(
        strategy.init(DEFAULT_DELEGATION_SOL)
    );
    const [burnerPubkey, setBurnerPubkey] = useState<string | null>(null);
    const [sessionBalanceLamports, setSessionBalanceLamports] = useState<number | null>(null);
    const [withdrawStatus, setWithdrawStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
    const [withdrawReceipt, setWithdrawReceipt] = useState<DevnetReceipt | null>(null);

    const refreshWalletBalance = useCallback(async () => {
        if (!publicKey) {
            setWalletBalanceSol(null);
            return;
        }
        try {
            const lamports = await connection.getBalance(publicKey, "confirmed");
            setWalletBalanceSol(lamports / LAMPORTS_PER_SOL);
        } catch {
        }
    }, [connection, publicKey]);

    useEffect(() => {
        void refreshWalletBalance();
    }, [refreshWalletBalance]);

    useEffect(() => {
        if (walletBalanceSol == null) return;
        const ceiling = Math.max(0.01, Math.min(1.0, walletBalanceSol - 0.01));
        setDelegatedAmountSol((prev) => Math.min(prev, ceiling));
    }, [walletBalanceSol]);

    const clearTimers = useCallback(() => {
        timeouts.current.forEach(clearTimeout);
        timeouts.current = [];
    }, []);

    const sleep = useCallback(
        (ms: number) =>
            new Promise<void>((resolve) => {
                const handle = setTimeout(resolve, ms);
                timeouts.current.push(handle);
            }),
        []
    );

    useEffect(() => () => {
        cancelRef.current = true;
        clearTimers();
    }, [clearTimers]);

    const ev = useCallback(
        (
            stage: StageId,
            title: string,
            detail?: string,
            extras?: {
                code?: string;
                rejected?: boolean;
                txSignature?: string;
                explorerUrl?: string;
            }
        ) => ({
            id: newEventId(),
            ts: Date.now(),
            stage,
            title,
            detail,
            ...(extras ?? {}),
        }),
        []
    );

    const runContinuousLoop = useCallback(
        async (walletPda: string, burner: Keypair) => {
            const loopId = ++loopOwnerRef.current;
            cancelRef.current = false;
            clearTimers();
            setExecutionReceipts([]);
            const initialState = strategy.init(delegatedAmountSol);
            strategyStateRef.current = initialState;
            setStrategyState(initialState);
            start({ walletPda, agentId: agent.id });

            const isLive = () =>
                !cancelRef.current && loopId === loopOwnerRef.current;

            let cycleIndex = 0;

            while (isLive()) {
                const cycleNumber = cycleIndex + 1;

                if (!pythCtxRef.current.isLive) {
                    appendEvent(
                        ev(
                            "policy",
                            `Cycle #${cycleNumber} · paused — oracle stale`,
                            "Pyth Hermes feed has not delivered an update within the freshness window. Waiting for live mid before signing."
                        )
                    );
                    await sleep(2_000);
                    continue;
                }

                const { next, effect } = strategy.tick(
                    strategyStateRef.current,
                    cycleIndex,
                    pythCtxRef.current
                );

                strategyStateRef.current = next;
                setStrategyState(next);

                resetStages();

                setStage("intent", "active");
                appendEvent(
                    ev(
                        "intent",
                        `Cycle #${cycleNumber} · ${effect.label}`,
                        effect.detail
                    )
                );
                await sleep(STAGE_MS.intent);
                if (!isLive()) break;
                setStage("intent", "ok");

                setStage("policy", "active");
                appendEvent(
                    ev(
                        "policy",
                        "Policy evaluated",
                        effect.policyEventDetail ??
                            `Trade size within policy. Notional ${effect.notionalUsdc.toFixed(0)} USDC.`
                    )
                );
                await sleep(STAGE_MS.policy);
                if (!isLive()) break;
                setStage("policy", "ok");

                setStage("oracle", "active");
                appendEvent(
                    ev(
                        "oracle",
                        agent.executionCopy.oracleTitle,
                        effect.oracleEventDetail ??
                            agent.executionCopy.oracleDetail
                    )
                );
                await sleep(STAGE_MS.oracle);
                if (!isLive()) break;
                setStage("oracle", "ok");

                setStage("build", "active");
                appendEvent(
                    ev(
                        "build",
                        "Canonical message built",
                        "169 bytes · SOLORA_INTENT_V2: program_id · wallet · nonce · expiry · blockhash · payload hash.",
                        {
                            code: "00000000  53 4f 4c 4f 52 41 5f 49 4e 54 45 4e 54 5f 56 32  |SOLORA_INTENT_V2|",
                        }
                    )
                );
                await sleep(STAGE_MS.build);
                if (!isLive()) break;
                setStage("build", "ok");

                setStage("sign", "active");
                appendEvent(
                    ev(
                        "sign",
                        "Session key signed intent",
                        effect.signEventDetail ??
                            `Devnet stand-in for the attested enclave. Pubkey ${shortPubkey(burner.publicKey.toBase58())} · 64-byte Ed25519 over the canonical bytes.`,
                        {
                            code: "ed25519: 7e2c f04b a91d 8e30 c517 6a44 d2b1 90ef …",
                        }
                    )
                );
                await sleep(STAGE_MS.sign);
                if (!isLive()) break;
                setStage("sign", "ok");

                setStage("broadcast", "active");
                appendEvent(
                    ev(
                        "broadcast",
                        `${effect.label} — broadcasting`,
                        effect.detail
                    )
                );

                const memo = `SOLORA_EXEC|agent=${agent.id}|cycle=${cycleNumber}|kind=${effect.memoKind}|notional=${effect.notionalUsdc.toFixed(2)}|ts=${Date.now()}`;
                try {
                    const result = await sendMemoWithSigner(
                        connection,
                        burner,
                        memo,
                        CLUSTER
                    );
                    if (!isLive()) break;
                    setStage("broadcast", "ok");

                    setStage("verify", "active");
                    await sleep(STAGE_MS.verify);
                    if (!isLive()) break;
                    setStage("verify", "ok");

                    const receipt: DevnetReceipt = {
                        label: effect.label,
                        signature: result.signature,
                        explorerUrl: result.explorerUrl,
                        notionalUsdc: effect.notionalUsdc,
                        ts: Date.now(),
                    };
                    setExecutionReceipts((prev) => {
                        const nextReceipts = [...prev, receipt];
                        if (
                            runIdRef.current &&
                            approvalReceiptRef.current
                        ) {
                            const approval = approvalReceiptRef.current;
                            upsertRunToPortfolio({
                                id: runIdRef.current,
                                walletPubkey: walletPda,
                                agentId: agent.id,
                                agentName: agent.name,
                                delegatedUsdc: Math.round(
                                    delegatedAmountSol * SOL_USDC_REF
                                ),
                                receipts: [
                                    {
                                        label: approval.label,
                                        signature: approval.signature,
                                        explorerUrl: approval.explorerUrl,
                                        notionalUsdc: 0,
                                        ts: approval.ts,
                                    },
                                    ...nextReceipts.map((r) => ({
                                        label: r.label,
                                        signature: r.signature,
                                        explorerUrl: r.explorerUrl,
                                        notionalUsdc: r.notionalUsdc,
                                        ts: r.ts,
                                    })),
                                ],
                                startedAt: runStartedAtRef.current,
                                completedAt: receipt.ts,
                                status: "running",
                            });
                        }
                        return nextReceipts;
                    });
                    setSessionBalanceLamports((prev) =>
                        prev != null ? Math.max(0, prev - TX_FEE_LAMPORTS) : prev
                    );
                    recordSuccess({
                        txSignature: result.signature,
                        notionalUsdc: effect.notionalUsdc,
                    });

                    const realizedSign = effect.realizedDelta >= 0 ? "+" : "−";
                    appendEvent(
                        ev(
                            "verify",
                            effect.label,
                            `Confirmed on ${CLUSTER}. Notional ${effect.notionalUsdc.toFixed(2)} USDC · cycle Δ ${realizedSign}${Math.abs(effect.realizedDelta).toFixed(3)} USDC.`,
                            {
                                txSignature: result.signature,
                                explorerUrl: result.explorerUrl,
                            }
                        )
                    );
                } catch (err) {
                    if (!isLive()) break;
                    setStage("broadcast", "rejected");
                    appendEvent(
                        ev(
                            "broadcast",
                            "Devnet broadcast retry",
                            err instanceof Error ? err.message : String(err)
                        )
                    );
                }

                cycleIndex += 1;
                await sleep(CYCLE_GAP_MS);
            }
        },
        [
            agent.executionCopy.oracleTitle,
            agent.executionCopy.oracleDetail,
            agent.id,
            agent.name,
            appendEvent,
            clearTimers,
            connection,
            delegatedAmountSol,
            ev,
            recordSuccess,
            resetStages,
            setStage,
            sleep,
            start,
            strategy,
            upsertRunToPortfolio,
        ]
    );

    const beginDelegatedRun = useCallback(() => {
        if (!connected || !publicKey) {
            setWalletModalVisible(true);
            return;
        }
        setApprovalError(undefined);
        setApprovalStatus("idle");
        setDelegationOpen(true);
    }, [connected, publicKey, setWalletModalVisible]);

    const approveDelegation = useCallback(async () => {
        if (!publicKey) {
            setWalletModalVisible(true);
            return;
        }

        const requiredSol = delegatedAmountSol + 0.005;
        if (
            walletBalanceSol != null &&
            walletBalanceSol < requiredSol
        ) {
            setApprovalStatus("failed");
            const isLikelyMainnet =
                walletBalanceSol < 0.001 && CLUSTER === "devnet";
            setApprovalError(
                isLikelyMainnet
                    ? `Wallet shows ${walletBalanceSol.toFixed(4)} SOL on Solana devnet — likely because your wallet is set to mainnet. Switch your wallet (e.g. Phantom → Settings → Active Network → Devnet) or fund the devnet address from https://faucet.solana.com/, then try again.`
                    : `Need ${requiredSol.toFixed(3)} SOL on devnet; you have ${walletBalanceSol.toFixed(4)}. Top up at https://faucet.solana.com/ and try again.`
            );
            return;
        }

        try {
            setApprovalStatus("signing");
            setApprovalError(undefined);
            setWithdrawStatus("idle");
            setWithdrawReceipt(null);

            const burner = Keypair.generate();
            burnerRef.current = burner;
            setBurnerPubkey(burner.publicKey.toBase58());

            setApprovalStatus("confirming");
            const result = await delegateToBurner(
                connection,
                wallet,
                burner.publicKey,
                delegatedAmountSol,
                CLUSTER
            );

            const receipt: DevnetReceipt = {
                label: `Delegation — ${delegatedAmountSol.toFixed(3)} SOL → session key`,
                signature: result.signature,
                explorerUrl: result.explorerUrl,
                notionalUsdc: Math.round(delegatedAmountSol * SOL_USDC_REF),
                ts: Date.now(),
            };
            setApprovalReceipt(receipt);
            approvalReceiptRef.current = receipt;
            setApprovalStatus("confirmed");
            setDelegationOpen(false);
            setSessionBalanceLamports(
                Math.floor(delegatedAmountSol * LAMPORTS_PER_SOL)
            );

            runIdRef.current = `run-${Date.now()}-${burner.publicKey.toBase58().slice(0, 6)}`;
            runStartedAtRef.current = receipt.ts;
            upsertRunToPortfolio({
                id: runIdRef.current,
                walletPubkey: publicKey.toBase58(),
                agentId: agent.id,
                agentName: agent.name,
                delegatedUsdc: Math.round(delegatedAmountSol * SOL_USDC_REF),
                receipts: [
                    {
                        label: receipt.label,
                        signature: receipt.signature,
                        explorerUrl: receipt.explorerUrl,
                        notionalUsdc: 0,
                        ts: receipt.ts,
                    },
                ],
                startedAt: receipt.ts,
                completedAt: receipt.ts,
                status: "running",
            });

            void refreshWalletBalance();
            void runContinuousLoop(publicKey.toBase58(), burner);
        } catch (error) {
            setApprovalStatus("failed");
            setApprovalReceipt(null);
            burnerRef.current = null;
            setBurnerPubkey(null);
            const raw = error instanceof Error ? error.message : String(error);
            const friendly = (() => {
                const lower = raw.toLowerCase();
                if (lower.includes("user rejected") || lower.includes("user denied")) {
                    return "Approval cancelled in the wallet. Try again when ready.";
                }
                if (
                    lower.includes("insufficient") ||
                    lower.includes("0x1") ||
                    lower.includes("insufficient funds")
                ) {
                    return `Wallet doesn't have enough SOL on devnet. We're on ${CLUSTER}; if your wallet is set to mainnet, switch it to devnet (Phantom → Settings → Active Network) and fund the address at https://faucet.solana.com/.`;
                }
                if (lower.includes("blockhash")) {
                    return "Devnet RPC timed out fetching a fresh blockhash. Try again in a few seconds.";
                }
                return raw;
            })();
            setApprovalError(friendly);
        }
    }, [
        agent.id,
        agent.name,
        connection,
        delegatedAmountSol,
        publicKey,
        refreshWalletBalance,
        runContinuousLoop,
        setWalletModalVisible,
        upsertRunToPortfolio,
        wallet,
        walletBalanceSol,
    ]);

    const withdrawSessionKey = useCallback(async () => {
        const burner = burnerRef.current;
        if (!burner || !publicKey) return;
        try {
            setWithdrawStatus("running");
            const result = await withdrawFromBurner(
                connection,
                burner,
                publicKey,
                CLUSTER
            );
            const returnedSol = result.lamportsReturned / LAMPORTS_PER_SOL;
            const receipt: DevnetReceipt = {
                label: `Withdrawal — ${returnedSol.toFixed(4)} SOL → wallet`,
                signature: result.signature,
                explorerUrl: result.explorerUrl,
                notionalUsdc: Math.round(returnedSol * SOL_USDC_REF),
                ts: Date.now(),
            };
            setWithdrawReceipt(receipt);
            setExecutionReceipts((prev) => {
                const nextReceipts = [...prev, receipt];
                if (runIdRef.current && approvalReceiptRef.current) {
                    const approval = approvalReceiptRef.current;
                    upsertRunToPortfolio({
                        id: runIdRef.current,
                        walletPubkey: publicKey.toBase58(),
                        agentId: agent.id,
                        agentName: agent.name,
                        delegatedUsdc: Math.round(
                            delegatedAmountSol * SOL_USDC_REF
                        ),
                        receipts: [
                            {
                                label: approval.label,
                                signature: approval.signature,
                                explorerUrl: approval.explorerUrl,
                                notionalUsdc: 0,
                                ts: approval.ts,
                            },
                            ...nextReceipts.map((r) => ({
                                label: r.label,
                                signature: r.signature,
                                explorerUrl: r.explorerUrl,
                                notionalUsdc: r.notionalUsdc,
                                ts: r.ts,
                            })),
                        ],
                        startedAt: runStartedAtRef.current || approval.ts,
                        completedAt: receipt.ts,
                        status: "withdrawn",
                    });
                }
                return nextReceipts;
            });
            setSessionBalanceLamports(TX_FEE_LAMPORTS);
            setWithdrawStatus("done");
            appendEvent(
                ev(
                    "verify",
                    receipt.label,
                    `Session key signed the refund. ${returnedSol.toFixed(4)} SOL returned to ${shortPubkey(publicKey.toBase58())}.`,
                    {
                        txSignature: result.signature,
                        explorerUrl: result.explorerUrl,
                    }
                )
            );
            void refreshWalletBalance();
        } catch (err) {
            setWithdrawStatus("failed");
            appendEvent(
                ev(
                    "verify",
                    "Withdrawal failed",
                    err instanceof Error ? err.message : String(err),
                    { rejected: true }
                )
            );
        }
    }, [
        agent.id,
        agent.name,
        appendEvent,
        connection,
        delegatedAmountSol,
        ev,
        publicKey,
        refreshWalletBalance,
        upsertRunToPortfolio,
    ]);

    const stopAgent = useCallback(() => {
        cancelRef.current = true;
        clearTimers();

        if (approvalReceipt && publicKey && runIdRef.current) {
            const completedAt =
                executionReceipts[executionReceipts.length - 1]?.ts ?? Date.now();
            const portfolioReceipts: PortfolioReceipt[] = [
                {
                    label: approvalReceipt.label,
                    signature: approvalReceipt.signature,
                    explorerUrl: approvalReceipt.explorerUrl,
                    notionalUsdc: 0,
                    ts: approvalReceipt.ts,
                },
                ...executionReceipts.map((r) => ({
                    label: r.label,
                    signature: r.signature,
                    explorerUrl: r.explorerUrl,
                    notionalUsdc: r.notionalUsdc,
                    ts: r.ts,
                })),
            ];
            upsertRunToPortfolio({
                id: runIdRef.current,
                walletPubkey: publicKey.toBase58(),
                agentId: agent.id,
                agentName: agent.name,
                delegatedUsdc: Math.round(delegatedAmountSol * SOL_USDC_REF),
                receipts: portfolioReceipts,
                startedAt: runStartedAtRef.current || approvalReceipt.ts,
                completedAt,
                status: "stopped",
            });
        }

        const remaining = sessionBalanceLamports != null
            ? (sessionBalanceLamports / LAMPORTS_PER_SOL).toFixed(4)
            : "—";
        const stopSummary = strategy.summary(
            strategyStateRef.current,
            executionReceipts.length,
            pythCtxRef.current
        );
        appendEvent(
            ev(
                "verify",
                "Agent stopped",
                `${stopSummary.pnlLine} Session key still holds ~${remaining} SOL — press Withdraw to refund.`
            )
        );
        stop();
    }, [
        upsertRunToPortfolio,
        agent.id,
        agent.name,
        appendEvent,
        approvalReceipt,
        clearTimers,
        delegatedAmountSol,
        ev,
        executionReceipts,
        publicKey,
        sessionBalanceLamports,
        stop,
        strategy,
    ]);

    const runReplay = useCallback(() => {
        setStage("broadcast", "active");
        const t1 = setTimeout(() => {
            appendEvent(
                ev(
                    "broadcast",
                    "Replay attempt broadcast",
                    "Same signed bytes resubmitted with a fresh blockhash. Solana SDK dedup is dodged; the on-chain program is now the gate.",
                    { rejected: true }
                )
            );
        }, 220);
        const t2 = setTimeout(() => {
            setStage("broadcast", "rejected");
            setStage("verify", "rejected");
            appendEvent(
                ev(
                    "verify",
                    "IntentNonceMismatch · 6018",
                    "On-chain verifier compared signed nonce against wallet.nonce. Signed = N, on-chain = N+1. Refused.",
                    { rejected: true }
                )
            );
            markRejection({
                code: 6018,
                name: "IntentNonceMismatch",
                description:
                    "Signed intent nonce does not match the on-chain wallet nonce. Replay rejected.",
            });
        }, 720);
        timeouts.current.push(t1, t2);
    }, [appendEvent, ev, markRejection, setStage]);

    const onReset = () => {
        cancelRef.current = true;
        clearTimers();
        setApprovalStatus("idle");
        setApprovalReceipt(null);
        approvalReceiptRef.current = null;
        setApprovalError(undefined);
        setDelegationOpen(false);
        setExecutionReceipts([]);
        setDelegatedAmountSol(DEFAULT_DELEGATION_SOL);
        const fresh = strategy.init(DEFAULT_DELEGATION_SOL);
        strategyStateRef.current = fresh;
        setStrategyState(fresh);
        burnerRef.current = null;
        setBurnerPubkey(null);
        setSessionBalanceLamports(null);
        setWithdrawStatus("idle");
        setWithdrawReceipt(null);
        runIdRef.current = null;
        runStartedAtRef.current = 0;
        reset();
        void refreshWalletBalance();
    };

    const mode = run?.mode ?? "idle";
    const isRunning = mode === "running";
    const isStopped = mode === "stopped";
    const legsConfirmed = run?.legsConfirmed ?? 0;
    const hasReplayableLeg = legsConfirmed > 0;
    const cumulativeNotional = run?.cumulativeNotionalUsdc ?? 0;

    const liveCtx: CycleContext = useMemo(
        () => ({
            livePrice: pyth.price ?? SOL_USDC_REF,
            confBps: pyth.confBps ?? 0,
            publishTimeMs: pyth.publishTimeMs ?? 0,
            isLive: pyth.isLive && pyth.price != null,
        }),
        [pyth.price, pyth.confBps, pyth.publishTimeMs, pyth.isLive]
    );

    const summary: StrategySummary = useMemo(
        () => strategy.summary(strategyState, legsConfirmed, liveCtx),
        [strategy, strategyState, legsConfirmed, liveCtx]
    );

    const allReceipts: DevnetReceipt[] = approvalReceipt
        ? [approvalReceipt, ...executionReceipts]
        : executionReceipts;

    const explorerForKey = (pk: string) =>
        `https://explorer.solana.com/address/${pk}${
            CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`
        }`;

    return (
        <>
            <div className="mb-4 grid gap-3 grid-cols-2 xl:grid-cols-4">
                <Card className="border-line-bright/80 bg-bg-surface/45">
                    <CardBody className="p-4">
                        <p className="text-eyebrow text-fg-dim">Delegated</p>
                        <p className="mt-2 mono-num text-[20px] sm:text-[22px] text-fg">
                            {approvalReceipt
                                ? `${delegatedAmountSol.toFixed(3)} SOL`
                                : "—"}
                        </p>
                        <p className="mt-1 text-[12px] text-fg-muted">
                            {approvalReceipt
                                ? `≈ ${Math.round(delegatedAmountSol * SOL_USDC_REF)} USDC · sent to session key`
                                : "Real devnet SOL from your wallet."}
                        </p>
                    </CardBody>
                </Card>
                <Card className="border-line-bright/80 bg-bg-surface/45">
                    <CardBody className="p-4">
                        <p className="text-eyebrow text-fg-dim">Session balance</p>
                        <p className="mt-2 mono-num text-[20px] sm:text-[22px] text-fg">
                            {sessionBalanceLamports != null
                                ? `${(sessionBalanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`
                                : "—"}
                        </p>
                        <p className="mt-1 text-[12px] text-fg-muted">
                            {withdrawStatus === "done"
                                ? "Refunded · session key drained."
                                : "Session key spends ~0.000005 SOL per cycle."}
                        </p>
                    </CardBody>
                </Card>
                <StrategyMetricCard metric={summary.metrics[0]} />
                <StrategyMetricCard metric={summary.metrics[1]} />
            </div>

            {/* Market state strip */}
            <div className="mb-3 grid gap-3 sm:grid-cols-4 rounded-xl border border-line bg-bg-surface/30 px-4 py-3">
                <div className="flex items-center gap-3">
                    <span className="text-eyebrow text-fg-dim">Wallet</span>
                    <span className="mono-num text-[15px] text-fg">
                        {walletBalanceSol != null
                            ? `${walletBalanceSol.toFixed(3)} SOL`
                            : "—"}
                    </span>
                </div>
                <StrategyTicker ticker={summary.tickers[0]} />
                <StrategyTicker ticker={summary.tickers[1]} />
                <div className="flex items-center gap-3 min-w-0">
                    <span className="text-eyebrow text-fg-dim shrink-0">Session</span>
                    {burnerPubkey ? (
                        <a
                            href={explorerForKey(burnerPubkey)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[12px] text-fg-soft hover:text-fg truncate inline-flex items-center gap-1.5"
                        >
                            {shortPubkey(burnerPubkey)}
                            <ExternalLink className="size-3 shrink-0" />
                        </a>
                    ) : (
                        <span className="text-[12px] text-fg-muted">awaiting delegation</span>
                    )}
                </div>
            </div>

            {/* Live Pyth banner */}
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg-surface/30 px-4 py-2.5">
                <span
                    className={`inline-flex size-1.5 rounded-full ${
                        pyth.isLive ? "bg-ok" : "bg-danger"
                    }`}
                />
                <span className="text-eyebrow text-fg-dim">Pyth Hermes</span>
                <span className="mono-num text-[13px] text-fg">
                    {pyth.price != null
                        ? `SOL/USDC ${pyth.price.toFixed(2)}`
                        : "subscribing…"}
                </span>
                {pyth.confBps != null && pyth.isLive && (
                    <span className="text-[11.5px] text-fg-muted">
                        ±{pyth.confBps.toFixed(0)} bps · {Math.max(
                            0,
                            Math.round((Date.now() - (pyth.publishTimeMs ?? 0)) / 1000)
                        )}s ago
                    </span>
                )}
                <span className="ml-auto font-mono text-[10.5px] text-fg-dim truncate hidden sm:inline">
                    {pyth.source}
                </span>
            </div>

            <p className="mb-6 text-[11.5px] text-fg-muted leading-relaxed">
                <span className="text-fg-soft">Price input is live</span> from
                Pyth Hermes mainnet — the mid above drives every cycle's
                quote, fill, and rebalance decision.{" "}
                <span className="text-fg-soft">P&L is still simulated</span>{" "}
                until the enclave wires real Phoenix / Jupiter execution on
                mainnet. What <em>is</em> real today: the{" "}
                {delegatedAmountSol.toFixed(3)} SOL you delegate to the
                session key, every cycle's on-chain memo signed by that key,
                and the withdrawal back to your wallet when you press Stop.
            </p>

            {allReceipts.length > 0 && (
                <div className="mb-6 rounded-2xl border border-line-bright bg-bg-surface/55 p-4 sm:p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-eyebrow text-fg-dim">Devnet receipts</p>
                        <p className="font-mono text-[11px] text-fg-dim">
                            {allReceipts.length} confirmed{legsConfirmed > 0 ? ` · ${cumulativeNotional.toFixed(0)} USDC notional` : ""}
                        </p>
                    </div>
                    <ul className="mt-3 grid gap-2 max-h-[260px] overflow-y-auto pr-1">
                        {allReceipts.slice().reverse().map((r) => (
                            <li
                                key={r.signature}
                                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-raised/30 px-3 py-2.5"
                            >
                                <div className="min-w-0">
                                    <p className="text-[12.5px] text-fg truncate">{r.label}</p>
                                    <p className="mt-0.5 font-mono text-[11px] text-fg-dim truncate">
                                        {shortSig(r.signature)}
                                    </p>
                                </div>
                                <a
                                    href={r.explorerUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-fg-soft hover:text-fg"
                                >
                                    explorer <ExternalLink className="size-3.5" />
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[320px_1fr] lg:h-[640px]">
                <aside className="rounded-xl border border-line bg-bg-surface/40 p-5 sm:p-6 overflow-y-auto">
                    <div className="mb-5 flex items-center justify-between">
                        <h3 className="text-[13.5px] font-medium text-fg">Execution pipeline</h3>
                        {run?.lastRejection ? (
                            <Badge tone="danger" dotted>
                                rejected
                            </Badge>
                        ) : isRunning ? (
                            <Badge tone="accent" dotted>
                                running
                            </Badge>
                        ) : isStopped ? (
                            <Badge tone="ok">stopped</Badge>
                        ) : (
                            <Badge>ready</Badge>
                        )}
                    </div>

                    <PipelineTrack
                        stages={run?.stages ?? emptyStages}
                        rejection={run?.lastRejection}
                    />

                    <div className="mt-6 grid gap-2 border-t border-line pt-4">
                        {!run && (
                            <Button onClick={beginDelegatedRun} className="w-full">
                                <Play className="size-4" /> Run agent
                            </Button>
                        )}
                        {isRunning && (
                            <Button variant="danger" onClick={stopAgent} className="w-full">
                                <Square className="size-4" /> Stop agent
                            </Button>
                        )}
                        {isStopped && (
                            <>
                                {withdrawStatus !== "done" && burnerRef.current && (
                                    <Button
                                        onClick={() => void withdrawSessionKey()}
                                        disabled={withdrawStatus === "running"}
                                        className="w-full"
                                    >
                                        <Wallet className="size-4" />
                                        {withdrawStatus === "running"
                                            ? "Withdrawing…"
                                            : withdrawStatus === "failed"
                                              ? "Retry withdraw"
                                              : "Withdraw remaining SOL"}
                                    </Button>
                                )}
                                {hasReplayableLeg && (
                                    <Button
                                        onClick={runReplay}
                                        variant="danger"
                                        className="w-full"
                                    >
                                        <ShieldCheck className="size-4" /> Simulate replay attack
                                    </Button>
                                )}
                                <Button
                                    onClick={onReset}
                                    variant="secondary"
                                    className="w-full"
                                >
                                    <RotateCcw className="size-4" /> Reset
                                </Button>
                            </>
                        )}
                    </div>

                    {run?.lastTxSignature && (
                        <a
                            href={`https://explorer.solana.com/tx/${run.lastTxSignature}${
                                CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`
                            }`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-fg-soft hover:text-fg group"
                        >
                            view latest tx on explorer
                            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                        </a>
                    )}

                    {approvalReceipt && (
                        <p className="mt-4 inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                            <Lock className="size-3.5" />
                            User signed once. Session key signs each cycle autonomously.
                        </p>
                    )}
                </aside>

                <div className="flex flex-col min-h-0 rounded-xl border border-line bg-bg-surface/40 p-5 sm:p-6">
                    <header className="mb-5 flex items-center justify-between shrink-0">
                        <h3 className="text-[13.5px] font-medium text-fg">Execution feed</h3>
                        <p className="font-mono text-[11px] text-fg-dim">
                            {run?.events.length ?? 0} events
                        </p>
                    </header>
                    <EventFeed events={run?.events ?? []} />
                </div>
            </div>

            <DelegationModal
                open={delegationOpen}
                agent={agent}
                delegatedAmountSol={delegatedAmountSol}
                walletBalanceSol={walletBalanceSol}
                approvalStatus={approvalStatus}
                approvalSignature={approvalReceipt?.signature}
                approvalExplorerUrl={approvalReceipt?.explorerUrl}
                approvalError={approvalError}
                walletConnected={connected}
                walletAddress={publicKey?.toBase58()}
                cluster={CLUSTER}
                onClose={() => setDelegationOpen(false)}
                onApprove={() => void approveDelegation()}
                onConnectWallet={() => setWalletModalVisible(true)}
                onAmountChange={(sol) => {
                    const ceiling = walletBalanceSol != null
                        ? Math.max(0.01, Math.min(1.0, walletBalanceSol - 0.01))
                        : 1.0;
                    const clamped = Math.min(ceiling, Math.max(0.01, sol));
                    setDelegatedAmountSol(clamped);
                }}
            />
        </>
    );
}


function StrategyMetricCard({ metric }: { metric: MetricCard }) {
    const toneClass =
        metric.tone === "pos"
            ? "text-fg"
            : metric.tone === "neg"
              ? "text-danger"
              : "text-fg";
    const ring = metric.tone === "pos" ? "ring-1 ring-ok/30" : "";
    return (
        <Card className={`border-line-bright/80 bg-bg-surface/45 ${ring}`}>
            <CardBody className="p-4">
                <p className="text-eyebrow text-fg-dim">{metric.label}</p>
                <p className={`mt-2 mono-num text-[20px] sm:text-[22px] ${toneClass}`}>
                    {metric.value}
                </p>
                {metric.helper && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-fg-muted">
                        {metric.tone === "neg" ? (
                            <TrendingDown className="size-3.5" />
                        ) : (
                            <TrendingUp className="size-3.5" />
                        )}
                        {metric.helper}
                    </p>
                )}
            </CardBody>
        </Card>
    );
}

function StrategyTicker({ ticker }: { ticker: Ticker }) {
    const toneClass =
        ticker.tone === "pos"
            ? "text-fg"
            : ticker.tone === "neg"
              ? "text-danger"
              : "text-fg";
    return (
        <div className="flex items-center gap-3 min-w-0">
            <span className="text-eyebrow text-fg-dim shrink-0">{ticker.label}</span>
            <span className={`mono-num text-[14px] truncate ${toneClass}`}>
                {ticker.value}
            </span>
        </div>
    );
}

const emptyStages = {
    intent: "idle",
    policy: "idle",
    oracle: "idle",
    build: "idle",
    sign: "idle",
    broadcast: "idle",
    verify: "idle",
} as const;
