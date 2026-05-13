"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ComponentType } from "react";
import { ArrowRight, Lock, ShieldCheck, Undo2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { Agent } from "@/lib/agents";

interface DelegationModalProps {
    open: boolean;
    agent: Agent;
    delegatedAmountSol: number;
    walletBalanceSol: number | null;
    approvalStatus: "idle" | "signing" | "confirming" | "confirmed" | "failed";
    approvalSignature?: string;
    approvalExplorerUrl?: string;
    approvalError?: string;
    walletConnected: boolean;
    walletAddress?: string;
    cluster?: "localnet" | "devnet" | "mainnet-beta";
    onClose: () => void;
    onApprove: () => void;
    onConnectWallet: () => void;
    onAmountChange: (sol: number) => void;
}

/** Reference SOL/USDC price for the informational USD equivalent shown next
 *  to the SOL amount. Devnet has no live SOL/USDC feed in this build. */
const REF_SOL_USDC = 142;

export function DelegationModal({
    open,
    agent,
    delegatedAmountSol,
    walletBalanceSol,
    approvalStatus,
    approvalSignature,
    approvalExplorerUrl,
    approvalError,
    walletConnected,
    walletAddress,
    cluster = "devnet",
    onClose,
    onApprove,
    onConnectWallet,
    onAmountChange,
}: DelegationModalProps) {
    const amountMin = 0.01;
    const ceiling = walletBalanceSol != null
        ? Math.max(amountMin, walletBalanceSol - 0.01)
        : 1.0;
    const amountMax = Math.min(1.0, ceiling);
    const usdEquiv = Math.round(delegatedAmountSol * REF_SOL_USDC);
    const maxLossBps = agent.config.stopLossBpsDefault || Math.max(60, agent.riskScore * 45);
    const estimatedRisk = `${agent.riskScore}/5`;
    const maxLossSol = +(delegatedAmountSol * maxLossBps / 10_000).toFixed(4);
    const maxTradeSol = +Math.min(delegatedAmountSol, 0.5).toFixed(3);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                    className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-bg/72 px-3 py-4 sm:px-4 sm:py-8 backdrop-blur-[10px] overflow-y-auto"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.12, ease: "easeOut" }}
                        className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-[22px] sm:rounded-[28px] border border-line-bright bg-bg-surface shadow-[0_28px_100px_rgba(0,0,0,0.45)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
                            <div className="border-b border-line/80 p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
                                <Badge tone="accent">Delegation vault</Badge>
                                <h2 className="mt-4 text-display-2 text-fg text-balance">
                                    Delegate only the capital this agent is allowed to use.
                                </h2>
                                <p className="mt-4 max-w-2xl text-[15px] leading-[1.65] text-fg-muted">
                                    The AI does not control your full wallet. It operates
                                    inside a bounded vault, can only trade within policy,
                                    and you can revoke access at any time.
                                </p>

                                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                                    <TrustTile
                                        icon={Wallet}
                                        title="Bounded balance"
                                        detail="Only delegated capital is usable."
                                    />
                                    <TrustTile
                                        icon={Lock}
                                        title="Policy enforced"
                                        detail="Max trade, loss, and protocols are capped."
                                    />
                                    <TrustTile
                                        icon={Undo2}
                                        title="Revocable"
                                        detail="Permissions can be withdrawn instantly."
                                    />
                                </div>

                                <div className="mt-8 rounded-2xl border border-line bg-bg-raised/35 p-5">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="text-eyebrow text-fg-dim">Wallet</p>
                                            <p className="mt-1 text-[14px] text-fg">
                                                {walletConnected
                                                    ? walletAddress ?? "Connected"
                                                    : "Disconnected"}
                                            </p>
                                        </div>
                                        <Badge tone={walletConnected ? "ok" : "warn"} dotted>
                                            {walletConnected ? "connected" : "required"}
                                        </Badge>
                                    </div>
                                    <p className="mt-3 text-[12.5px] leading-relaxed text-fg-muted">
                                        This approval funds a session key on Solana{" "}
                                        {cluster} with a small fee budget. After it
                                        confirms, the agent runs autonomously — every
                                        cycle is signed by the session key, not your wallet.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-6 p-6 sm:p-8 lg:p-10">
                                <Card className="border-line-bright/80 bg-bg-raised/30">
                                    <CardBody className="space-y-5">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-eyebrow text-fg-dim">
                                                    Delegate amount
                                                </p>
                                                <p className="mt-1 text-[13px] text-fg-soft">
                                                    Tune the capital envelope for this run.
                                                </p>
                                            </div>
                                            <Badge tone="neutral">demo vault</Badge>
                                        </div>

                                        <div className="rounded-2xl border border-line bg-bg-surface px-4 py-4">
                                            <div className="flex items-end justify-between gap-4">
                                                <div>
                                                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-fg-dim">
                                                        Delegate from your wallet
                                                    </p>
                                                    <p className="mt-2 mono-num text-[28px] text-fg">
                                                        {delegatedAmountSol.toFixed(2)} SOL
                                                    </p>
                                                    <p className="mt-1 text-[12px] text-fg-muted">
                                                        ≈ {usdEquiv} USDC at ${REF_SOL_USDC}/SOL
                                                    </p>
                                                </div>
                                                <p className="text-[11.5px] text-fg-muted text-right max-w-32">
                                                    {walletBalanceSol != null
                                                        ? `Wallet: ${walletBalanceSol.toFixed(3)} SOL`
                                                        : "Connect to read balance."}
                                                </p>
                                            </div>

                                            <input
                                                type="range"
                                                min={amountMin}
                                                max={amountMax}
                                                step={0.01}
                                                value={delegatedAmountSol}
                                                onChange={(event) =>
                                                    onAmountChange(Number(event.target.value))
                                                }
                                                className="mt-5 w-full accent-[hsl(var(--accent))]"
                                            />

                                            <div className="mt-3 flex items-center justify-between text-[11.5px] text-fg-dim">
                                                <span>{amountMin.toFixed(2)} SOL</span>
                                                <span>{amountMax.toFixed(2)} SOL</span>
                                            </div>
                                        </div>

                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Metric label="Max loss (policy)" value={`${maxLossSol} SOL`} />
                                            <Metric label="Max trade (policy)" value={`${maxTradeSol} SOL`} />
                                            <Metric label="Risk" value={estimatedRisk} />
                                            <Metric label="Protocols" value={agent.protocols.length.toString()} />
                                        </div>

                                        <div className="rounded-2xl border border-line bg-bg-surface/50 p-4">
                                            <p className="text-eyebrow text-fg-dim">Allowed protocols</p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {agent.protocols.map((protocol) => (
                                                    <Badge key={protocol.name} tone="neutral">
                                                        {protocol.name}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>

                                        {approvalStatus !== "idle" && (
                                            <div
                                                className={cn(
                                                    "rounded-2xl border px-4 py-4",
                                                    approvalStatus === "failed"
                                                        ? "border-danger/30 bg-danger/[0.06]"
                                                        : "border-ok/30 bg-ok/[0.05]"
                                                )}
                                            >
                                                <div className="flex items-center justify-between gap-4">
                                                    <div>
                                                        <p className="text-[12px] font-medium text-fg">
                                                            {approvalStatus === "signing"
                                                                ? "Signing vault receipt"
                                                                : approvalStatus === "confirming"
                                                                    ? "Waiting for devnet confirmation"
                                                                    : approvalStatus === "failed"
                                                                        ? "Delegation failed"
                                                                        : "Delegation confirmed"}
                                                        </p>
                                                        <p className="mt-1 text-[12px] text-fg-muted">
                                                            {approvalStatus === "failed"
                                                                ? approvalError ??
                                                                "The wallet rejected the approval transaction."
                                                                : approvalSignature
                                                                    ? `Signature ${approvalSignature.slice(0, 8)}…${approvalSignature.slice(-8)}`
                                                                    : "The approval transaction is moving through the network."}
                                                        </p>
                                                    </div>
                                                    {approvalStatus !== "failed" && (
                                                        <Badge tone="ok">{cluster}</Badge>
                                                    )}
                                                </div>

                                                {approvalSignature && (
                                                    <a
                                                        href={
                                                            approvalExplorerUrl ??
                                                            `https://explorer.solana.com/tx/${approvalSignature}${
                                                                cluster === "mainnet-beta"
                                                                    ? ""
                                                                    : `?cluster=${cluster}`
                                                            }`
                                                        }
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-fg-soft hover:text-fg"
                                                    >
                                                        View approval on explorer
                                                        <ArrowRight className="size-3.5" />
                                                    </a>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex flex-wrap items-center gap-3 pt-1">
                                            <Button
                                                onClick={walletConnected ? onApprove : onConnectWallet}
                                                disabled={approvalStatus === "signing" || approvalStatus === "confirming"}
                                                className="min-w-[220px]"
                                            >
                                                <ShieldCheck className="size-4" />
                                                {walletConnected
                                                    ? approvalStatus === "signing"
                                                        ? "Preparing approval"
                                                        : approvalStatus === "confirming"
                                                            ? "Confirming on devnet"
                                                            : "Approve delegation & run"
                                                    : "Connect wallet to continue"}
                                            </Button>
                                            <Button variant="secondary" onClick={onClose}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </CardBody>
                                </Card>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function TrustTile({
    icon: Icon,
    title,
    detail,
}: {
    icon: ComponentType<{ className?: string }>;
    title: string;
    detail: string;
}) {
    return (
        <div className="rounded-2xl border border-line bg-bg-surface/70 p-4">
            <Icon className="size-4 text-fg-muted" />
            <p className="mt-3 text-[13px] font-medium text-fg">{title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{detail}</p>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-line bg-bg-surface/50 px-4 py-3">
            <p className="text-eyebrow text-fg-dim">{label}</p>
            <p className="mt-1.5 mono-num text-[14px] text-fg">{value}</p>
        </div>
    );
}