"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { useExecution, type StageId } from "@/lib/execution-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { PipelineTrack } from "@/components/pipeline-track";
import { EventFeed } from "@/components/event-feed";
import { DelegationModal } from "@/components/delegation-modal";
import { type Agent, formatUsdc } from "@/lib/agents";
import { sendMemo, shortSig } from "@/lib/devnet-tx";
import { CLUSTER } from "@/lib/solora";

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
}

const newEventId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

export function AgentRunner({ agent }: AgentRunnerProps) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { publicKey, connected } = wallet;
    const { setVisible: setWalletModalVisible } = useWalletModal();
    const { run, start, appendEvent, setStage, succeed, reject, reset } = useExecution(
        useShallow((s) => ({
            run: s.run,
            start: s.start,
            appendEvent: s.appendEvent,
            setStage: s.setStage,
            succeed: s.succeed,
            reject: s.reject,
            reset: s.reset,
        }))
    );

    const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
    const cancelRef = useRef(false);
    const [delegationOpen, setDelegationOpen] = useState(false);
    const [delegatedAmountUsdc, setDelegatedAmountUsdc] = useState(
        Math.min(agent.config.capitalUsdcMax, Math.max(agent.config.capitalUsdcMin, 2500))
    );
    const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("idle");
    const [approvalReceipt, setApprovalReceipt] = useState<DevnetReceipt | null>(null);
    const [approvalError, setApprovalError] = useState<string | undefined>();
    const [executionReceipts, setExecutionReceipts] = useState<DevnetReceipt[]>([]);
    const [utilizedCapital, setUtilizedCapital] = useState(0);

    const cancelTimers = useCallback(() => {
        cancelRef.current = true;
        timeouts.current.forEach(clearTimeout);
        timeouts.current = [];
    }, []);

    const schedule = useCallback((ms: number, fn: () => void) => {
        timeouts.current.push(
            setTimeout(() => {
                if (cancelRef.current) return;
                fn();
            }, ms)
        );
    }, []);

    useEffect(() => () => cancelTimers(), [cancelTimers]);

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

    /**
     * Sends a real Memo-program devnet transaction. Used both for the
     * delegation receipt and for each "agent leg" played out after the mock
     * pipeline finishes. Returns the receipt or throws on failure.
     */
    const broadcastReceipt = useCallback(
        async (label: string, memo: string): Promise<DevnetReceipt> => {
            const result = await sendMemo(connection, wallet, memo, CLUSTER);
            return {
                label,
                signature: result.signature,
                explorerUrl: result.explorerUrl,
            };
        },
        [connection, wallet]
    );

    /**
     * Plays the cinematic 7-stage pipeline, then sends N real devnet memo
     * transactions in sequence so judges see real signatures + explorer links.
     */
    const launchRun = useCallback(
        async (walletPda: string, approval: DevnetReceipt) => {
            cancelRef.current = false;
            cancelTimers();
            cancelRef.current = false;
            setExecutionReceipts([]);
            setUtilizedCapital(0);
            start({ walletPda, agentId: agent.id });

            const amountLabel = formatUsdc(delegatedAmountUsdc);
            const maxLossBps =
                agent.config.stopLossBpsDefault ||
                Math.max(60, agent.riskScore * 45);
            const walletShort = `${walletPda.slice(0, 4)}…${walletPda.slice(-4)}`;

            schedule(120, () => {
                setStage("intent", "active");
                appendEvent(
                    ev(
                        "intent",
                        "Intent received",
                        `${agent.name}: signed intent submitted from ${walletShort}. Delegated cap ${amountLabel} USDC.`
                    )
                );
            });
            schedule(640, () => setStage("intent", "ok"));

            schedule(720, () => {
                setStage("policy", "active");
                appendEvent(
                    ev(
                        "policy",
                        "Policy evaluated",
                        `delegated ${amountLabel} USDC · max trade ${formatUsdc(agent.config.maxTradeUsdcDefault)} · max loss ${maxLossBps} bps · allowlist ok.`
                    )
                );
            });
            schedule(1340, () => setStage("policy", "ok"));

            schedule(1440, () => {
                setStage("oracle", "active");
                appendEvent(
                    ev(
                        "oracle",
                        "Pyth update verified",
                        "Fresh price window accepted · Wormhole guardian quorum reached · merkle proof to feed_id checks out."
                    )
                );
            });
            schedule(2280, () => setStage("oracle", "ok"));

            schedule(2380, () => {
                setStage("build", "active");
                appendEvent(
                    ev(
                        "build",
                        "Canonical message built",
                        "169 bytes · SOLORA_INTENT_V2 layout: program_id · wallet · nonce · expiry · blockhash · payload hash.",
                        {
                            code: "00000000  53 4f 4c 4f 52 41 5f 49 4e 54 45 4e 54 5f 56 32  |SOLORA_INTENT_V2|",
                        }
                    )
                );
            });
            schedule(3060, () => setStage("build", "ok"));

            schedule(3180, () => {
                setStage("sign", "active");
                appendEvent(
                    ev(
                        "sign",
                        "Enclave signed intent",
                        "Sealed Ed25519 key produced a 64-byte signature inside the TEE.",
                        {
                            code: "ed25519: 7e2c f04b a91d 8e30 c517 6a44 d2b1 90ef …",
                        }
                    )
                );
            });
            schedule(3960, () => setStage("sign", "ok"));

            schedule(4080, () => {
                setStage("broadcast", "active");
                appendEvent(
                    ev(
                        "broadcast",
                        "Assembling transaction",
                        "ComputeBudget · Ed25519Program (verify ix at index 0) · execute_transfer at index 1."
                    )
                );
            });
            schedule(4860, () => setStage("broadcast", "ok"));

            schedule(4980, () => {
                setStage("verify", "active");
                appendEvent(
                    ev(
                        "verify",
                        "On-chain verifier engaged",
                        "Ed25519 sysvar · SlotHashes binding · nonce check · payload hash."
                    )
                );
            });

            // After the mock pipeline finishes (~5.6s), play the real
            // devnet legs sequentially. Each one is a confirmed memo tx.
            schedule(5700, () => {
                setStage("verify", "ok");
                appendEvent(
                    ev(
                        "verify",
                        "Pipeline confirmed",
                        "Mock verifier accepted. Streaming real devnet legs next."
                    )
                );
                void playRealLegs();
            });

            const playRealLegs = async () => {
                const sigs: DevnetReceipt[] = [];
                for (let i = 0; i < agent.executionLegs.length; i += 1) {
                    if (cancelRef.current) return;
                    const leg = agent.executionLegs[i]!;
                    const memo =
                        `SOLORA_EXEC|agent=${agent.id}|leg=${i + 1}|kind=${leg.memoKind}|cap=${delegatedAmountUsdc}|ts=${Date.now()}`;
                    appendEvent(
                        ev("broadcast", `Leg ${i + 1}/${agent.executionLegs.length} — broadcasting`, leg.detail)
                    );
                    try {
                        const receipt = await broadcastReceipt(leg.label, memo);
                        if (cancelRef.current) return;
                        sigs.push(receipt);
                        setExecutionReceipts((prev) => [...prev, receipt]);
                        setUtilizedCapital((prev) => prev + leg.notionalUsdc);
                        appendEvent(
                            ev("verify", leg.label, `Confirmed on Solana ${CLUSTER}. Notional ${formatUsdc(leg.notionalUsdc)} USDC.`, {
                                txSignature: receipt.signature,
                                explorerUrl: receipt.explorerUrl,
                            })
                        );
                    } catch (err) {
                        appendEvent(
                            ev(
                                "verify",
                                "Devnet broadcast failed",
                                err instanceof Error ? err.message : String(err),
                                { rejected: true }
                            )
                        );
                        reject({
                            code: -1,
                            name: "DevnetBroadcastFailed",
                            description:
                                err instanceof Error ? err.message : "Devnet RPC refused the leg.",
                        });
                        return;
                    }
                }

                if (cancelRef.current) return;
                const finalSig = sigs[sigs.length - 1]?.signature ?? approval.signature;
                appendEvent(
                    ev(
                        "verify",
                        "Run complete",
                        `${sigs.length} live devnet legs confirmed. Cumulative notional ${formatUsdc(sigs.reduce((acc, _, idx) => acc + agent.executionLegs[idx]!.notionalUsdc, 0))} USDC.`,
                        { txSignature: finalSig }
                    )
                );
                succeed(finalSig);
            };
        },
        [
            agent,
            appendEvent,
            broadcastReceipt,
            cancelTimers,
            delegatedAmountUsdc,
            ev,
            reject,
            schedule,
            setStage,
            start,
            succeed,
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

        try {
            setApprovalStatus("signing");
            setApprovalError(undefined);
            const memo =
                `SOLORA_DELEGATE|agent=${agent.id}|cap=${delegatedAmountUsdc}|wallet=${publicKey.toBase58().slice(0, 12)}|ts=${Date.now()}`;
            setApprovalStatus("confirming");
            const receipt = await broadcastReceipt("Delegation approval", memo);
            setApprovalReceipt(receipt);
            setApprovalStatus("confirmed");
            setDelegationOpen(false);
            await launchRun(publicKey.toBase58(), receipt);
        } catch (error) {
            setApprovalStatus("failed");
            setApprovalReceipt(null);
            setApprovalError(
                error instanceof Error
                    ? error.message
                    : "The wallet rejected the delegation approval."
            );
        }
    }, [
        agent.id,
        broadcastReceipt,
        delegatedAmountUsdc,
        launchRun,
        publicKey,
        setWalletModalVisible,
    ]);

    const runReplay = useCallback(() => {
        cancelRef.current = false;
        cancelTimers();
        cancelRef.current = false;

        setStage("broadcast", "active");
        schedule(220, () => {
            appendEvent(
                ev(
                    "broadcast",
                    "Replay attempt broadcast",
                    "Same signed bytes resubmitted with a fresh blockhash. Solana SDK-level dedup is dodged; the program is now the gate.",
                    { rejected: true }
                )
            );
        });
        schedule(720, () => {
            setStage("broadcast", "rejected");
            setStage("verify", "rejected");
            appendEvent(
                ev(
                    "verify",
                    "IntentNonceMismatch · 6018",
                    "On-chain verifier compared signed nonce against wallet.nonce. Signed = 0, on-chain = 1. Refused.",
                    { rejected: true }
                )
            );
            reject({
                code: 6018,
                name: "IntentNonceMismatch",
                description:
                    "Signed intent nonce does not match the on-chain wallet nonce. Replay rejected.",
            });
        });
    }, [appendEvent, cancelTimers, ev, reject, schedule, setStage]);

    const onReset = () => {
        cancelTimers();
        cancelRef.current = false;
        setApprovalStatus("idle");
        setApprovalReceipt(null);
        setApprovalError(undefined);
        setDelegationOpen(false);
        setExecutionReceipts([]);
        setUtilizedCapital(0);
        setDelegatedAmountUsdc(
            Math.min(agent.config.capitalUsdcMax, Math.max(agent.config.capitalUsdcMin, 2500))
        );
        reset();
    };

    const isRunning = run?.running ?? false;
    const hasResult = run && !run.running;
    const succeeded = hasResult && !!run?.txSignature && !run?.rejection;
    const vaultStatus = approvalReceipt ? "active · revocable" : "awaiting approval";
    const delegatedCapital = approvalReceipt ? delegatedAmountUsdc : 0;
    const availableBalance = approvalReceipt
        ? Math.max(0, delegatedCapital - utilizedCapital)
        : 0;
    const allReceipts: DevnetReceipt[] = approvalReceipt
        ? [approvalReceipt, ...executionReceipts]
        : executionReceipts;

    return (
        <>
            <div className="mb-6 grid gap-3 grid-cols-2 xl:grid-cols-4">
                <Card className="border-line-bright/80 bg-bg-surface/45">
                    <CardBody className="p-4">
                        <p className="text-eyebrow text-fg-dim">Delegated capital</p>
                        <p className="mt-2 mono-num text-[20px] sm:text-[22px] text-fg">
                            {approvalReceipt ? `${formatUsdc(delegatedCapital)} USDC` : "—"}
                        </p>
                        <p className="mt-1 text-[12px] text-fg-muted">Bounded vault balance.</p>
                    </CardBody>
                </Card>
                <Card className="border-line-bright/80 bg-bg-surface/45">
                    <CardBody className="p-4">
                        <p className="text-eyebrow text-fg-dim">Available</p>
                        <p className="mt-2 mono-num text-[20px] sm:text-[22px] text-fg">
                            {approvalReceipt ? `${formatUsdc(availableBalance)} USDC` : "—"}
                        </p>
                        <p className="mt-1 text-[12px] text-fg-muted">Revocable at any time.</p>
                    </CardBody>
                </Card>
                <Card className="border-line-bright/80 bg-bg-surface/45">
                    <CardBody className="p-4">
                        <p className="text-eyebrow text-fg-dim">Utilized</p>
                        <p className="mt-2 mono-num text-[20px] sm:text-[22px] text-fg">
                            {approvalReceipt ? `${formatUsdc(utilizedCapital)} USDC` : "—"}
                        </p>
                        <p className="mt-1 text-[12px] text-fg-muted">Active exposure under policy.</p>
                    </CardBody>
                </Card>
                <Card className="border-line-bright/80 bg-bg-surface/45">
                    <CardBody className="p-4">
                        <p className="text-eyebrow text-fg-dim">Vault status</p>
                        <p className="mt-2 mono-num text-[14px] sm:text-[15px] text-fg">{vaultStatus}</p>
                        <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-fg-muted">
                            <Lock className="size-3.5" />
                            {approvalReceipt ? `Delegation on Solana ${CLUSTER}.` : "Connect to approve."}
                        </p>
                    </CardBody>
                </Card>
            </div>

            {allReceipts.length > 0 && (
                <div className="mb-6 rounded-2xl border border-line-bright bg-bg-surface/55 p-4 sm:p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-eyebrow text-fg-dim">Devnet receipts</p>
                        <p className="font-mono text-[11px] text-fg-dim">
                            {allReceipts.length} confirmed
                        </p>
                    </div>
                    <ul className="mt-3 grid gap-2">
                        {allReceipts.map((r) => (
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

            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
                <aside className="rounded-xl border border-line bg-bg-surface/40 p-5 sm:p-6">
                    <div className="mb-5 flex items-center justify-between">
                        <h3 className="text-[13.5px] font-medium text-fg">Execution pipeline</h3>
                        {run?.rejection ? (
                            <Badge tone="danger" dotted>
                                rejected
                            </Badge>
                        ) : isRunning ? (
                            <Badge tone="accent" dotted>
                                running
                            </Badge>
                        ) : succeeded ? (
                            <Badge tone="ok">confirmed</Badge>
                        ) : (
                            <Badge>ready</Badge>
                        )}
                    </div>

                    <PipelineTrack
                        stages={run?.stages ?? emptyStages}
                        rejection={run?.rejection}
                    />

                    <div className="mt-6 grid gap-2 border-t border-line pt-4">
                        {!run && (
                            <Button onClick={beginDelegatedRun} className="w-full">
                                <Play className="size-4" /> Run agent
                            </Button>
                        )}
                        {isRunning && (
                            <Button variant="secondary" onClick={onReset} className="w-full">
                                <Square className="size-4" /> Cancel
                            </Button>
                        )}
                        {succeeded && (
                            <>
                                <Button onClick={runReplay} variant="danger" className="w-full">
                                    <ShieldCheck className="size-4" /> Simulate replay attack
                                </Button>
                                <Button onClick={onReset} variant="secondary" className="w-full">
                                    <RotateCcw className="size-4" /> Reset
                                </Button>
                            </>
                        )}
                        {run?.rejection && (
                            <Button onClick={onReset} variant="secondary" className="w-full">
                                <RotateCcw className="size-4" /> Reset
                            </Button>
                        )}
                    </div>

                    {run?.txSignature && (
                        <a
                            href={`https://explorer.solana.com/tx/${run.txSignature}${
                                CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`
                            }`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-fg-soft hover:text-fg group"
                        >
                            view final tx on explorer
                            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                        </a>
                    )}
                </aside>

                <div className="rounded-xl border border-line bg-bg-surface/40 p-5 sm:p-6">
                    <header className="mb-5 flex items-center justify-between">
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
                delegatedAmountUsdc={delegatedAmountUsdc}
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
                onAmountChange={(amount) => {
                    const clamped = Math.min(
                        agent.config.capitalUsdcMax,
                        Math.max(agent.config.capitalUsdcMin, amount)
                    );
                    setDelegatedAmountUsdc(clamped);
                }}
            />
        </>
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
