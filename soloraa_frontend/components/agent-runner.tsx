"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
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
import {
    useExecution,
    type DevnetReceipt,
} from "@/lib/execution-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { PipelineTrack } from "@/components/pipeline-track";
import { EventFeed } from "@/components/event-feed";
import { DelegationModal } from "@/components/delegation-modal";
import { type Agent } from "@/lib/agents";
import { shortPubkey, shortSig } from "@/lib/devnet-tx";
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

export function AgentRunner({ agent }: AgentRunnerProps) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { publicKey, connected } = wallet;
    const { setVisible: setWalletModalVisible } = useWalletModal();

    const {
        storeRun,
        storeBurnerPubkey,
        delegatedSol,
        storeSessionBalanceLamports,
        storeApprovalReceipt,
        approvalStatus,
        approvalError,
        storeExecutionReceipts,
        storeWithdrawStatus,
        strategyState,
        strategyKind,
        startAgent,
        stopAgent,
        withdrawSessionKey,
        runReplay,
        resetAgent,
        setDelegatedSol,
        setApprovalError,
    } = useExecution(
        useShallow((s) => ({
            storeRun: s.run,
            storeBurnerPubkey: s.burnerPubkey,
            delegatedSol: s.delegatedSol,
            storeSessionBalanceLamports: s.sessionBalanceLamports,
            storeApprovalReceipt: s.approvalReceipt,
            approvalStatus: s.approvalStatus,
            approvalError: s.approvalError,
            storeExecutionReceipts: s.executionReceipts,
            storeWithdrawStatus: s.withdrawStatus,
            strategyState: s.strategyState,
            strategyKind: s.strategyKind,
            startAgent: s.startAgent,
            stopAgent: s.stopAgent,
            withdrawSessionKey: s.withdrawSessionKey,
            runReplay: s.runReplay,
            resetAgent: s.resetAgent,
            setDelegatedSol: s.setDelegatedSol,
            setApprovalError: s.setApprovalError,
        }))
    );

    const strategy = useMemo(() => getStrategy(agent.kind), [agent.kind]);

    const isOurRun = storeRun?.agentId === agent.id;
    const run = isOurRun ? storeRun : null;
    const burnerPubkey = isOurRun ? storeBurnerPubkey : null;
    const sessionBalanceLamports = isOurRun ? storeSessionBalanceLamports : null;
    const approvalReceipt = isOurRun ? storeApprovalReceipt : null;
    const executionReceipts = isOurRun ? storeExecutionReceipts : [];
    const withdrawStatus = isOurRun ? storeWithdrawStatus : "idle";

    const [delegationOpen, setDelegationOpen] = useState(false);
    const [walletBalanceSol, setWalletBalanceSol] = useState<number | null>(null);

    const refreshWalletBalance = useCallback(async () => {
        if (!publicKey) {
            setWalletBalanceSol(null);
            return;
        }
        try {
            const lamports = await connection.getBalance(publicKey, "confirmed");
            setWalletBalanceSol(lamports / LAMPORTS_PER_SOL);
        } catch {
            // soft-fail
        }
    }, [connection, publicKey]);

    useEffect(() => {
        void refreshWalletBalance();
    }, [refreshWalletBalance]);

    useEffect(() => {
        if (walletBalanceSol == null) return;
        const ceiling = Math.max(0.01, Math.min(1.0, walletBalanceSol - 0.01));
        if (delegatedSol > ceiling) setDelegatedSol(ceiling);
    }, [walletBalanceSol, delegatedSol, setDelegatedSol]);

    useEffect(() => {
        if (approvalStatus === "confirmed") setDelegationOpen(false);
    }, [approvalStatus]);

    const pyth = usePythPrice();
    const liveCtx: CycleContext = useMemo(
        () => ({
            livePrice: pyth.price ?? SOL_USDC_REF,
            confBps: pyth.confBps ?? 0,
            publishTimeMs: pyth.publishTimeMs ?? 0,
            isLive: pyth.isLive && pyth.price != null,
        }),
        [pyth.price, pyth.confBps, pyth.publishTimeMs, pyth.isLive]
    );

    const mode = run?.mode ?? "idle";
    const isRunning = mode === "running";
    const isStopped = mode === "stopped";
    const legsConfirmed = run?.legsConfirmed ?? 0;
    const hasReplayableLeg = legsConfirmed > 0;
    const cumulativeNotional = run?.cumulativeNotionalUsdc ?? 0;

    const summary: StrategySummary = useMemo(() => {
        const state =
            strategyState != null && strategyKind === agent.kind
                ? strategyState
                : strategy.init(delegatedSol);
        return strategy.summary(state, legsConfirmed, liveCtx);
    }, [
        strategy,
        strategyState,
        strategyKind,
        agent.kind,
        legsConfirmed,
        liveCtx,
        delegatedSol,
    ]);

    const allReceipts: DevnetReceipt[] = approvalReceipt
        ? [approvalReceipt, ...executionReceipts]
        : executionReceipts;

    const beginDelegatedRun = useCallback(() => {
        if (!connected || !publicKey) {
            setWalletModalVisible(true);
            return;
        }
        setApprovalError(undefined);
        setDelegationOpen(true);
    }, [connected, publicKey, setApprovalError, setWalletModalVisible]);

    const onApprove = useCallback(() => {
        void startAgent({
            connection,
            wallet,
            agentId: agent.id,
            agentName: agent.name,
            strategyKind: agent.kind,
            strategy,
            delegatedSol,
            walletBalanceSol,
        });
    }, [
        startAgent,
        connection,
        wallet,
        agent.id,
        agent.name,
        agent.kind,
        strategy,
        delegatedSol,
        walletBalanceSol,
    ]);

    const onWithdraw = useCallback(() => {
        if (!publicKey) return;
        void withdrawSessionKey(connection, publicKey).then(() => {
            void refreshWalletBalance();
        });
    }, [connection, publicKey, refreshWalletBalance, withdrawSessionKey]);

    const onReset = useCallback(() => {
        resetAgent();
        void refreshWalletBalance();
    }, [refreshWalletBalance, resetAgent]);

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
                                ? `${delegatedSol.toFixed(3)} SOL`
                                : "—"}
                        </p>
                        <p className="mt-1 text-[12px] text-fg-muted">
                            {approvalReceipt
                                ? `≈ ${Math.round(delegatedSol * SOL_USDC_REF)} USDC · sent to session key`
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
                {delegatedSol.toFixed(3)} SOL you delegate to the session key,
                every cycle's on-chain memo signed by that key, and the
                withdrawal back to your wallet when you press Stop.
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
                                {withdrawStatus !== "done" && burnerPubkey && (
                                    <Button
                                        onClick={onWithdraw}
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
                delegatedAmountSol={delegatedSol}
                walletBalanceSol={walletBalanceSol}
                approvalStatus={approvalStatus}
                approvalSignature={approvalReceipt?.signature}
                approvalExplorerUrl={approvalReceipt?.explorerUrl}
                approvalError={approvalError}
                walletConnected={connected}
                walletAddress={publicKey?.toBase58()}
                cluster={CLUSTER}
                onClose={() => setDelegationOpen(false)}
                onApprove={onApprove}
                onConnectWallet={() => setWalletModalVisible(true)}
                onAmountChange={(sol) => {
                    const ceiling = walletBalanceSol != null
                        ? Math.max(0.01, Math.min(1.0, walletBalanceSol - 0.01))
                        : 1.0;
                    const clamped = Math.min(ceiling, Math.max(0.01, sol));
                    setDelegatedSol(clamped);
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
