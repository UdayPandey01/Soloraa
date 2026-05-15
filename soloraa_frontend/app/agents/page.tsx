"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AgentCard } from "@/components/agent-card";
import { AGENTS, type AgentRisk } from "@/lib/agents";
import { cn } from "@/lib/cn";

const RISK_FILTERS = ["all", "conservative", "moderate", "aggressive"] as const;
type Filter = (typeof RISK_FILTERS)[number];

export default function AgentsPage() {
    const [filter, setFilter] = useState<Filter>("all");
    const filtered = useMemo(() => {
        if (filter === "all") return AGENTS;
        return AGENTS.filter((a) => a.risk === (filter as AgentRisk));
    }, [filter]);

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-20 sm:pb-24 lg:pt-20">
            <header className="max-w-3xl">
                <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-fg-dim">
                    Catalogue · attested agents
                </p>
                <h1
                    className="mt-5 sm:mt-6 text-[clamp(38px,7vw,84px)] leading-[0.98] tracking-tight text-fg"
                    style={{ fontFamily: "var(--font-display)" }}
                >
                    Six agents.{" "}
                    <em className="italic text-fg-soft">
                        One trust boundary.
                    </em>
                </h1>
                <p className="mt-5 sm:mt-6 text-[16px] sm:text-[17px] leading-[1.6] text-fg-muted max-w-2xl">
                    Every agent below ships with a default policy bound to the same
                    on-chain verifier. The agent never signs — it submits structured
                    intents to the attested enclave, which signs only when policy and
                    oracle conditions are met.
                </p>
            </header>

            <nav className="mt-10 sm:mt-12 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div className="flex items-center gap-1.5 flex-wrap">
                    {RISK_FILTERS.map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={cn(
                                "rounded-md px-3 py-1.5 text-[12.5px] font-medium tracking-tight transition-colors",
                                filter === f
                                    ? "text-fg bg-bg-surface"
                                    : "text-fg-muted hover:text-fg hover:bg-bg-surface"
                            )}
                            type="button"
                        >
                            {f === "all" ? "All" : f[0]!.toUpperCase() + f.slice(1)}
                        </button>
                    ))}
                </div>
                <p className="text-[12px] text-fg-dim font-mono">
                    {filtered.length} of {AGENTS.length} · attested execution
                </p>
            </nav>

            <div className="mt-6 sm:mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                ))}
            </div>

            <section className="mt-20 sm:mt-28 rounded-2xl border border-line bg-bg-surface/40 p-7 sm:p-10">
                <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-fg-dim">
                    Bring your own strategy
                </p>
                <h2
                    className="mt-4 text-[clamp(28px,4vw,48px)] leading-[1.05] tracking-tight text-fg"
                    style={{ fontFamily: "var(--font-display)" }}
                >
                    Not a closed catalogue.{" "}
                    <em className="italic text-fg-soft">A trust layer.</em>
                </h2>
                <p className="mt-4 max-w-2xl text-[15px] sm:text-[16px] leading-[1.6] text-fg-muted">
                    Soloraa is execution infrastructure. Any agent that can describe a
                    structured intent — swap, transfer, lend, rebalance, CPI — plugs into
                    the same enclave through{" "}
                    <code className="font-mono text-fg-soft">@soloraaa/sdk</code>.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                    <Link
                        href="/developers"
                        className="inline-flex items-center gap-2 rounded-full h-11 px-5 text-[14px] font-medium bg-fg text-bg hover:opacity-90 transition-opacity"
                    >
                        Read the SDK overview
                    </Link>
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 rounded-full h-11 px-5 text-[14px] font-medium border border-line-bright text-fg hover:border-fg-dim transition-colors"
                    >
                        Integration docs
                    </Link>
                </div>
            </section>
        </div>
    );
}
