import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { AgentRunner } from "@/components/agent-runner";
import {
    AGENTS,
    formatBps,
    formatCadence,
    formatUsdc,
    getAgent,
} from "@/lib/agents";

interface PageProps {
    params: Promise<{ id: string }>;
}

export function generateStaticParams() {
    return AGENTS.map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;
    const agent = getAgent(id);
    if (!agent) return { title: "Agent" };
    return {
        title: agent.name,
        description: agent.tagline,
    };
}

const statusTone = {
    live: "ok",
    beta: "warn",
    preview: "neutral",
} as const;

export default async function AgentDetailPage({ params }: PageProps) {
    const { id } = await params;
    const agent = getAgent(id);
    if (!agent) notFound();

    const cfg = agent.config;

    return (
        <div className="mx-auto max-w-7xl px-6 pt-12 pb-24 lg:pt-16">
            <Link
                href="/agents"
                className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg transition-colors"
            >
                <ArrowLeft className="size-3.5" /> All agents
            </Link>

            {/* Header */}
            <header className="mt-8 grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:items-end border-b border-line pb-12">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-display-2 text-fg">{agent.name}</h1>
                        <Badge tone={statusTone[agent.status]}>{agent.status}</Badge>
                    </div>
                    <p className="mt-4 max-w-2xl text-[17px] leading-[1.55] text-fg-muted">
                        {agent.tagline}
                    </p>
                </div>
                <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
                    <StatBlock label="Sim. APY" value={formatBps(agent.simulatedApyBps)} />
                    <StatBlock label="Cadence" value={`~${formatCadence(agent.cadenceSecMedian)}`} />
                    <StatBlock
                        label="Max drawdown"
                        value={formatBps(agent.simulatedDrawdownBps)}
                    />
                </dl>
            </header>

            {/* Thesis + protocols */}
            <section className="mt-12 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
                <Card>
                    <CardBody className="space-y-4">
                        <h2 className="text-eyebrow text-fg-dim">Thesis</h2>
                        <p className="text-[15px] leading-[1.6] text-fg-soft">
                            {agent.thesis}
                        </p>
                        <h2 className="text-eyebrow text-fg-dim pt-2">How it executes</h2>
                        <p className="text-[15px] leading-[1.6] text-fg-soft">
                            {agent.description}
                        </p>
                    </CardBody>
                </Card>
                <Card>
                    <CardBody>
                        <h2 className="text-eyebrow text-fg-dim">Allowed protocols</h2>
                        <ul className="mt-3 divide-y divide-line">
                            {agent.protocols.map((p) => (
                                <li
                                    key={p.name}
                                    className="flex items-center justify-between py-3"
                                >
                                    <div>
                                        <p className="text-[13.5px] text-fg">{p.name}</p>
                                        <p className="text-[11.5px] text-fg-muted font-mono mt-0.5">
                                            {p.role}
                                        </p>
                                    </div>
                                    <code className="text-[11px] text-fg-dim font-mono">
                                        {p.programId}
                                    </code>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-4 text-[12px] text-fg-muted leading-relaxed">
                            Every entry is enforced by the on-chain CPI allowlist
                            (<code className="font-mono">Policy.allowed_programs[16]</code>).
                            Even a perfectly-signed intent cannot CPI into a program not on
                            this list.
                        </p>
                    </CardBody>
                </Card>
            </section>

            {/* Config */}
            <section className="mt-12">
                <header className="flex items-baseline justify-between">
                    <div>
                        <h2 className="text-display-3 text-fg">Default policy</h2>
                        <p className="mt-2 text-[14px] text-fg-muted max-w-2xl">
                            These bounds become wallet.policy on-chain. The enclave will
                            refuse to sign anything outside them.
                        </p>
                    </div>
                    <code className="font-mono text-[11px] text-fg-dim hidden md:block">
                        programs/solora/src/state.rs · Policy
                    </code>
                </header>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <PolicyField
                        label="Capital allocation"
                        value={`${formatUsdc(cfg.capitalUsdcMin)} – ${formatUsdc(cfg.capitalUsdcMax)} USDC`}
                    />
                    <PolicyField
                        label="Max trade size"
                        value={`${formatUsdc(cfg.maxTradeUsdcDefault)} USDC`}
                    />
                    <PolicyField
                        label="Max slippage"
                        value={`${cfg.maxSlippageBpsDefault} bps`}
                    />
                    <PolicyField
                        label="Stop loss"
                        value={cfg.stopLossBpsDefault ? `${cfg.stopLossBpsDefault} bps` : "—"}
                    />
                    <PolicyField
                        label="Cooldown"
                        value={formatCadence(cfg.cooldownSecDefault)}
                    />
                    <PolicyField
                        label="Executions / hour"
                        value={`≤ ${cfg.executionsPerHourDefault}`}
                    />
                    <PolicyField
                        label="Allowed tokens"
                        value={cfg.allowedTokens.join(" · ")}
                    />
                    <PolicyField label="Enclave signer" value="attested · Nitro v1" />
                </div>
            </section>

            {/* Run + live execution */}
            <section className="mt-12">
                <h2 className="text-display-3 text-fg">Live execution</h2>
                <p className="mt-2 text-[14px] text-fg-muted max-w-2xl">
                    Press <span className="text-fg">Run agent</span> to open the
                    delegation vault, approve a bounded amount, and step through the
                    full execution lifecycle. After confirmation, press{" "}
                    <span className="text-fg">Simulate replay attack</span> — the same
                    signed bytes will be rebroadcast and rejected on-chain with{" "}
                    <code className="font-mono text-fg-soft">IntentNonceMismatch (6018)</code>.
                </p>
                <div className="mt-6">
                    <AgentRunner agent={agent} />
                </div>
            </section>
        </div>
    );
}

function StatBlock({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-bg-surface px-4 py-4">
            <p className="text-eyebrow text-fg-dim">{label}</p>
            <p className="mt-1.5 mono-num text-[18px] text-fg">{value}</p>
        </div>
    );
}

function PolicyField({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-line bg-bg-surface/50 px-4 py-3.5">
            <p className="text-eyebrow text-fg-dim">{label}</p>
            <p className="mt-1.5 text-[13.5px] text-fg-soft">{value}</p>
        </div>
    );
}
