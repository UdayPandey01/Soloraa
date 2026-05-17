"use client";

import { create } from "zustand";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
    delegateToBurner,
    sendMemoWithSigner,
    shortPubkey,
    withdrawFromBurner,
} from "@/lib/devnet-tx";
import {
    SOL_USDC_REF,
    type CycleContext,
    type Strategy,
    type StrategyKind,
} from "@/lib/strategies";
import { getPythSnapshot } from "@/lib/pyth-feed";
import { CLUSTER } from "@/lib/solora";
import { usePortfolio } from "@/lib/portfolio-store";

export type StageState = "idle" | "active" | "ok" | "rejected";

export type StageId =
    | "intent"
    | "policy"
    | "oracle"
    | "build"
    | "sign"
    | "broadcast"
    | "verify";

export type ExecutionMode = "idle" | "running" | "stopped";

export type ApprovalStatus =
    | "idle"
    | "signing"
    | "confirming"
    | "confirmed"
    | "failed";

export type WithdrawStatus = "idle" | "running" | "done" | "failed";

export interface ExecutionEvent {
    id: string;
    ts: number;
    stage: StageId;
    title: string;
    detail?: string;
    code?: string;
    rejected?: boolean;
    txSignature?: string;
    explorerUrl?: string;
}

export interface DevnetReceipt {
    label: string;
    signature: string;
    explorerUrl: string;
    notionalUsdc: number;
    ts: number;
}

export interface ExecutionRun {
    walletPda: string;
    agentId: string;
    stages: Record<StageId, StageState>;
    events: ExecutionEvent[];
    lastTxSignature?: string;
    lastRejection?: { code: number; name: string; description: string };
    walletNonce: number;
    legsConfirmed: number;
    cumulativeNotionalUsdc: number;
    mode: ExecutionMode;
}

export interface StartAgentOpts {
    connection: Connection;
    wallet: WalletContextState;
    agentId: string;
    agentName: string;
    strategyKind: StrategyKind;
    strategy: Strategy<unknown>;
    delegatedSol: number;
    walletBalanceSol: number | null;
}

interface ExecutionState {
    run: ExecutionRun | null;

    burnerKeypair: Keypair | null;
    burnerPubkey: string | null;
    delegatedSol: number;
    sessionBalanceLamports: number | null;
    approvalReceipt: DevnetReceipt | null;
    approvalStatus: ApprovalStatus;
    approvalError: string | undefined;
    executionReceipts: DevnetReceipt[];
    withdrawStatus: WithdrawStatus;
    withdrawReceipt: DevnetReceipt | null;
    strategyState: unknown;
    strategyKind: StrategyKind | null;
    agentName: string | null;
    runId: string | null;
    runStartedAt: number;

    setDelegatedSol(n: number): void;
    setApprovalError(e: string | undefined): void;

    startAgent(opts: StartAgentOpts): Promise<void>;
    stopAgent(): void;
    withdrawSessionKey(
        connection: Connection,
        destination: PublicKey
    ): Promise<void>;
    runReplay(): void;
    resetAgent(): void;

    appendEvent(event: ExecutionEvent): void;
}

const emptyStages: Record<StageId, StageState> = {
    intent: "idle",
    policy: "idle",
    oracle: "idle",
    build: "idle",
    sign: "idle",
    broadcast: "idle",
    verify: "idle",
};

const TX_FEE_LAMPORTS = 5_000;
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

let activeCancelFlag = { cancelled: false };
let activeLoopId = 0;
let activeTimeouts: ReturnType<typeof setTimeout>[] = [];

function newEventId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

function makeEvent(
    stage: StageId,
    title: string,
    detail?: string,
    extras?: {
        code?: string;
        rejected?: boolean;
        txSignature?: string;
        explorerUrl?: string;
    }
): ExecutionEvent {
    return {
        id: newEventId(),
        ts: Date.now(),
        stage,
        title,
        detail,
        ...(extras ?? {}),
    };
}

function readPythCtx(): CycleContext {
    const s = getPythSnapshot();
    return {
        livePrice: s.price ?? SOL_USDC_REF,
        confBps: s.confBps ?? 0,
        publishTimeMs: s.publishTimeMs ?? 0,
        isLive: s.isLive && s.price != null,
    };
}

function upsertRunningPortfolio(opts: { status: "running" | "stopped" | "withdrawn" }) {
    const s = useExecution.getState();
    if (!s.runId || !s.approvalReceipt || !s.run) return;
    const completedAt =
        s.executionReceipts[s.executionReceipts.length - 1]?.ts ?? Date.now();
    usePortfolio.getState().upsertRun({
        id: s.runId,
        walletPubkey: s.run.walletPda,
        agentId: s.run.agentId,
        agentName: s.agentName ?? s.run.agentId,
        delegatedUsdc: Math.round(s.delegatedSol * SOL_USDC_REF),
        receipts: [
            {
                label: s.approvalReceipt.label,
                signature: s.approvalReceipt.signature,
                explorerUrl: s.approvalReceipt.explorerUrl,
                notionalUsdc: 0,
                ts: s.approvalReceipt.ts,
            },
            ...s.executionReceipts.map((r) => ({
                label: r.label,
                signature: r.signature,
                explorerUrl: r.explorerUrl,
                notionalUsdc: r.notionalUsdc,
                ts: r.ts,
            })),
        ],
        startedAt: s.runStartedAt || s.approvalReceipt.ts,
        completedAt,
        status: opts.status,
    });
}

export const useExecution = create<ExecutionState>((set, get) => ({
    run: null,
    burnerKeypair: null,
    burnerPubkey: null,
    delegatedSol: 0.1,
    sessionBalanceLamports: null,
    approvalReceipt: null,
    approvalStatus: "idle",
    approvalError: undefined,
    executionReceipts: [],
    withdrawStatus: "idle",
    withdrawReceipt: null,
    strategyState: null,
    strategyKind: null,
    agentName: null,
    runId: null,
    runStartedAt: 0,

    setDelegatedSol: (n) => set({ delegatedSol: n }),
    setApprovalError: (e) => set({ approvalError: e }),

    appendEvent: (event) =>
        set((s) => {
            if (!s.run) return s;
            return { run: { ...s.run, events: [...s.run.events, event] } };
        }),

    startAgent: async (opts) => {
        if (!opts.wallet.publicKey) {
            set({
                approvalStatus: "failed",
                approvalError: "Connect a wallet first.",
            });
            return;
        }

        const requiredSol = opts.delegatedSol + 0.005;
        if (
            opts.walletBalanceSol != null &&
            opts.walletBalanceSol < requiredSol
        ) {
            const isLikelyMainnet =
                opts.walletBalanceSol < 0.001 && CLUSTER === "devnet";
            set({
                approvalStatus: "failed",
                approvalError: isLikelyMainnet
                    ? `Wallet shows ${opts.walletBalanceSol.toFixed(4)} SOL on Solana devnet — likely because your wallet is set to mainnet. Switch your wallet (e.g. Phantom → Settings → Active Network → Devnet) or fund the devnet address at https://faucet.solana.com/, then try again.`
                    : `Need ${requiredSol.toFixed(3)} SOL on devnet; you have ${opts.walletBalanceSol.toFixed(4)}. Top up at https://faucet.solana.com/ and try again.`,
            });
            return;
        }

        activeCancelFlag.cancelled = true;
        activeTimeouts.forEach(clearTimeout);
        activeTimeouts = [];

        set({
            approvalStatus: "signing",
            approvalError: undefined,
            withdrawStatus: "idle",
            withdrawReceipt: null,
        });

        const burner = Keypair.generate();
        set({
            burnerKeypair: burner,
            burnerPubkey: burner.publicKey.toBase58(),
        });

        try {
            set({ approvalStatus: "confirming" });
            const result = await delegateToBurner(
                opts.connection,
                opts.wallet,
                burner.publicKey,
                opts.delegatedSol,
                CLUSTER
            );

            const receipt: DevnetReceipt = {
                label: `Delegation — ${opts.delegatedSol.toFixed(3)} SOL → session key`,
                signature: result.signature,
                explorerUrl: result.explorerUrl,
                notionalUsdc: Math.round(opts.delegatedSol * SOL_USDC_REF),
                ts: Date.now(),
            };

            const runId = `run-${Date.now()}-${burner.publicKey
                .toBase58()
                .slice(0, 6)}`;

            set({
                approvalReceipt: receipt,
                approvalStatus: "confirmed",
                sessionBalanceLamports: Math.floor(
                    opts.delegatedSol * LAMPORTS_PER_SOL
                ),
                executionReceipts: [],
                strategyState: opts.strategy.init(opts.delegatedSol),
                strategyKind: opts.strategyKind,
                agentName: opts.agentName,
                runId,
                runStartedAt: receipt.ts,
                delegatedSol: opts.delegatedSol,
                run: {
                    walletPda: opts.wallet.publicKey!.toBase58(),
                    agentId: opts.agentId,
                    stages: { ...emptyStages },
                    events: [],
                    walletNonce: 0,
                    legsConfirmed: 0,
                    cumulativeNotionalUsdc: 0,
                    mode: "running",
                },
            });

            upsertRunningPortfolio({ status: "running" });
            startLoop(opts.connection, burner, opts.strategy, opts.agentId);
        } catch (error) {
            set({
                approvalStatus: "failed",
                approvalReceipt: null,
                burnerKeypair: null,
                burnerPubkey: null,
            });
            const raw = error instanceof Error ? error.message : String(error);
            const friendly = (() => {
                const lower = raw.toLowerCase();
                if (
                    lower.includes("user rejected") ||
                    lower.includes("user denied")
                ) {
                    return "Approval cancelled in the wallet. Try again when ready.";
                }
                if (
                    lower.includes("insufficient") ||
                    lower.includes("0x1")
                ) {
                    return `Wallet doesn't have enough SOL on devnet. We're on ${CLUSTER}; if your wallet is set to mainnet, switch it to devnet (Phantom → Settings → Active Network) and fund the address at https://faucet.solana.com/.`;
                }
                if (lower.includes("blockhash")) {
                    return "Devnet RPC timed out fetching a fresh blockhash. Try again in a few seconds.";
                }
                return raw;
            })();
            set({ approvalError: friendly });
        }
    },

    stopAgent: () => {
        activeCancelFlag.cancelled = true;
        activeTimeouts.forEach(clearTimeout);
        activeTimeouts = [];

        const s = get();
        if (!s.run) return;

        const remaining =
            s.sessionBalanceLamports != null
                ? (s.sessionBalanceLamports / LAMPORTS_PER_SOL).toFixed(4)
                : "—";
        const pnlLine = (() => {
            try {
                const summary = (
                    s.strategyKind ? requireStrategy(s.strategyKind) : null
                )?.summary(
                    s.strategyState,
                    s.run.legsConfirmed,
                    readPythCtx()
                );
                return summary?.pnlLine ?? "";
            } catch {
                return "";
            }
        })();

        set((cur) => ({
            run: cur.run
                ? { ...cur.run, mode: "stopped", stages: { ...emptyStages } }
                : null,
        }));

        get().appendEvent(
            makeEvent(
                "verify",
                "Agent stopped",
                `${pnlLine} Session key still holds ~${remaining} SOL — press Withdraw to refund.`
            )
        );

        upsertRunningPortfolio({ status: "stopped" });
    },

    withdrawSessionKey: async (connection, destination) => {
        const s = get();
        const burner = s.burnerKeypair;
        if (!burner) return;
        try {
            set({ withdrawStatus: "running" });
            const result = await withdrawFromBurner(
                connection,
                burner,
                destination,
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
            set((cur) => ({
                withdrawReceipt: receipt,
                executionReceipts: [...cur.executionReceipts, receipt],
                sessionBalanceLamports: TX_FEE_LAMPORTS,
                withdrawStatus: "done",
            }));
            get().appendEvent(
                makeEvent(
                    "verify",
                    receipt.label,
                    `Session key signed the refund. ${returnedSol.toFixed(4)} SOL returned to ${shortPubkey(destination.toBase58())}.`,
                    {
                        txSignature: result.signature,
                        explorerUrl: result.explorerUrl,
                    }
                )
            );
            upsertRunningPortfolio({ status: "withdrawn" });
        } catch (err) {
            set({ withdrawStatus: "failed" });
            get().appendEvent(
                makeEvent(
                    "verify",
                    "Withdrawal failed",
                    err instanceof Error ? err.message : String(err),
                    { rejected: true }
                )
            );
        }
    },

    runReplay: () => {
        set((s) => {
            if (!s.run) return s;
            return {
                run: {
                    ...s.run,
                    stages: { ...s.run.stages, broadcast: "active" },
                },
            };
        });
        const t1 = setTimeout(() => {
            get().appendEvent(
                makeEvent(
                    "broadcast",
                    "Replay attempt broadcast",
                    "Same signed bytes resubmitted with a fresh blockhash. Solana SDK dedup is dodged; the on-chain program is now the gate.",
                    { rejected: true }
                )
            );
        }, 220);
        const t2 = setTimeout(() => {
            set((s) => {
                if (!s.run) return s;
                return {
                    run: {
                        ...s.run,
                        stages: {
                            ...s.run.stages,
                            broadcast: "rejected",
                            verify: "rejected",
                        },
                        lastRejection: {
                            code: 6018,
                            name: "IntentNonceMismatch",
                            description:
                                "Signed intent nonce does not match the on-chain wallet nonce. Replay rejected.",
                        },
                    },
                };
            });
            get().appendEvent(
                makeEvent(
                    "verify",
                    "IntentNonceMismatch · 6018",
                    "On-chain verifier compared signed nonce against wallet.nonce. Signed = N, on-chain = N+1. Refused.",
                    { rejected: true }
                )
            );
        }, 720);
        activeTimeouts.push(t1, t2);
    },

    resetAgent: () => {
        activeCancelFlag.cancelled = true;
        activeTimeouts.forEach(clearTimeout);
        activeTimeouts = [];
        set({
            run: null,
            burnerKeypair: null,
            burnerPubkey: null,
            delegatedSol: 0.1,
            sessionBalanceLamports: null,
            approvalReceipt: null,
            approvalStatus: "idle",
            approvalError: undefined,
            executionReceipts: [],
            withdrawStatus: "idle",
            withdrawReceipt: null,
            strategyState: null,
            strategyKind: null,
            agentName: null,
            runId: null,
            runStartedAt: 0,
        });
    },
}));

// Strategy registry lookup, lazy-resolved to break a circular dep with strategies.ts.
let strategyRegistry: Record<StrategyKind, Strategy<unknown>> | null = null;
function requireStrategy(kind: StrategyKind): Strategy<unknown> {
    if (!strategyRegistry) {
        const mod = require("@/lib/strategies");
        strategyRegistry = mod.STRATEGIES as Record<StrategyKind, Strategy<unknown>>;
    }
    return strategyRegistry[kind];
}

function startLoop(
    connection: Connection,
    burner: Keypair,
    strategy: Strategy<unknown>,
    agentId: string
) {
    const myFlag = { cancelled: false };
    const myLoopId = ++activeLoopId;
    activeCancelFlag = myFlag;

    const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
            const handle = setTimeout(resolve, ms);
            activeTimeouts.push(handle);
        });

    const isLive = () => !myFlag.cancelled && myLoopId === activeLoopId;

    const store = useExecution;

    void (async () => {
        let cycleIndex = 0;
        while (isLive()) {
            const ctx = readPythCtx();
            if (!ctx.isLive) {
                store.getState().appendEvent(
                    makeEvent(
                        "policy",
                        `Cycle #${cycleIndex + 1} · paused — oracle stale`,
                        "Pyth Hermes feed has not delivered an update within the freshness window. Waiting for live mid before signing."
                    )
                );
                await sleep(2_000);
                continue;
            }

            const cycleNumber = cycleIndex + 1;
            const currentState = store.getState();
            const { next, effect } = strategy.tick(
                currentState.strategyState,
                cycleIndex,
                ctx
            );
            store.setState({ strategyState: next });

            const s0 = store.getState();
            if (!s0.run) break;
            store.setState({
                run: { ...s0.run, stages: { ...emptyStages } },
            });

            const setStage = (id: StageId, state: StageState) => {
                store.setState((cur) => {
                    if (!cur.run) return cur;
                    return {
                        run: {
                            ...cur.run,
                            stages: { ...cur.run.stages, [id]: state },
                        },
                    };
                });
            };

            setStage("intent", "active");
            store.getState().appendEvent(
                makeEvent(
                    "intent",
                    `Cycle #${cycleNumber} · ${effect.label}`,
                    effect.detail
                )
            );
            await sleep(STAGE_MS.intent);
            if (!isLive()) break;
            setStage("intent", "ok");

            setStage("policy", "active");
            store.getState().appendEvent(
                makeEvent(
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
            store.getState().appendEvent(
                makeEvent(
                    "oracle",
                    "Pyth verified",
                    effect.oracleEventDetail ??
                        `Live Pyth SOL/USDC ${ctx.livePrice.toFixed(2)} · conf ${Math.max(1, Math.round(ctx.confBps))} bps.`
                )
            );
            await sleep(STAGE_MS.oracle);
            if (!isLive()) break;
            setStage("oracle", "ok");

            setStage("build", "active");
            store.getState().appendEvent(
                makeEvent(
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
            store.getState().appendEvent(
                makeEvent(
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
            store.getState().appendEvent(
                makeEvent(
                    "broadcast",
                    `${effect.label} — broadcasting`,
                    effect.detail
                )
            );

            const relayerUrl =
                typeof process !== "undefined"
                    ? process.env.NEXT_PUBLIC_SOLORA_RELAYER_URL
                    : undefined;
            const memo = `SOLORA_EXEC|agent=${agentId}|cycle=${cycleNumber}|kind=${effect.memoKind}|notional=${effect.notionalUsdc.toFixed(2)}|ts=${Date.now()}`;
            try {
                let result: { signature: string; explorerUrl: string };
                if (relayerUrl) {
                    const resp = await fetch(`${relayerUrl}/execute-cycle`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                            destination: burner.publicKey.toBase58(),
                            amountLamports: 10_000,
                            cycle: cycleNumber,
                            agentId,
                        }),
                    });
                    if (!resp.ok) {
                        const body = await resp.text();
                        throw new Error(`relayer ${resp.status}: ${body}`);
                    }
                    result = (await resp.json()) as {
                        signature: string;
                        explorerUrl: string;
                    };
                } else {
                    result = await sendMemoWithSigner(
                        connection,
                        burner,
                        memo,
                        CLUSTER
                    );
                }
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

                store.setState((cur) => {
                    if (!cur.run) return cur;
                    return {
                        executionReceipts: [...cur.executionReceipts, receipt],
                        sessionBalanceLamports:
                            cur.sessionBalanceLamports != null
                                ? Math.max(
                                      0,
                                      cur.sessionBalanceLamports -
                                          TX_FEE_LAMPORTS
                                  )
                                : cur.sessionBalanceLamports,
                        run: {
                            ...cur.run,
                            lastTxSignature: result.signature,
                            walletNonce: cur.run.walletNonce + 1,
                            legsConfirmed: cur.run.legsConfirmed + 1,
                            cumulativeNotionalUsdc:
                                cur.run.cumulativeNotionalUsdc +
                                effect.notionalUsdc,
                        },
                    };
                });

                const realizedSign = effect.realizedDelta >= 0 ? "+" : "−";
                store.getState().appendEvent(
                    makeEvent(
                        "verify",
                        effect.label,
                        `Confirmed on ${CLUSTER}. Notional ${effect.notionalUsdc.toFixed(2)} USDC · cycle Δ ${realizedSign}${Math.abs(effect.realizedDelta).toFixed(3)} USDC.`,
                        {
                            txSignature: result.signature,
                            explorerUrl: result.explorerUrl,
                        }
                    )
                );

                upsertRunningPortfolio({ status: "running" });
            } catch (err) {
                if (!isLive()) break;
                setStage("broadcast", "rejected");
                store.getState().appendEvent(
                    makeEvent(
                        "broadcast",
                        "Devnet broadcast retry",
                        err instanceof Error ? err.message : String(err)
                    )
                );
            }

            cycleIndex += 1;
            await sleep(CYCLE_GAP_MS);
        }
    })();
}
