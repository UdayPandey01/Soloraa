"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AgentCard } from "@/components/agent-card";
import { Badge } from "@/components/ui/badge";
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
                <Badge>Library</Badge>
                <h1 className="mt-4 sm:mt-5 text-display-2 text-balance text-fg">
                    Agents you can run today.
                </h1>
                <p className="mt-4 sm:mt-5 text-[15px] sm:text-[17px] leading-[1.55] text-fg-muted">
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

            <section className="mt-20 sm:mt-24 rounded-xl border border-line bg-bg-surface/40 p-6 sm:p-7">
                <h2 className="text-display-3 text-fg">
                    Need your own strategy?
                </h2>
                <p className="mt-3 max-w-2xl text-[14px] sm:text-[15px] leading-relaxed text-fg-muted">
                    Soloraa is execution infrastructure, not a closed catalog. Any
                    agent that can produce a structured intent — a swap, transfer,
                    lend, rebalance — can plug into the enclave through the SDK.
                </p>
                <div className="mt-5 sm:mt-6 flex flex-wrap gap-3">
                    <Link
                        href="/developers"
                        className="inline-flex items-center gap-2 rounded-md h-10 px-4 text-sm font-medium bg-fg text-bg hover:opacity-90"
                    >
                        Read the SDK overview
                    </Link>
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 rounded-md h-10 px-4 text-sm font-medium border border-line-bright text-fg hover:border-fg-dim"
                    >
                        Integration docs
                    </Link>
                </div>
            </section>
        </div>
    );
}
