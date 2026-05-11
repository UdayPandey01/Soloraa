import type { Metadata } from "next";
import { AgentCard } from "@/components/agent-card";
import { Badge } from "@/components/ui/badge";
import { AGENTS } from "@/lib/agents";

export const metadata: Metadata = {
    title: "Agents",
    description:
        "Browse Soloraa's library of attested autonomous agents. Each agent runs under a cryptographic policy verified on Solana.",
};

const RISK_FILTERS = ["all", "conservative", "moderate", "aggressive"] as const;

export default function AgentsPage() {
    return (
        <div className="mx-auto max-w-7xl px-6 pt-16 pb-24 lg:pt-20">
            <header className="max-w-3xl">
                <Badge>Library</Badge>
                <h1 className="mt-5 text-display-2 text-balance text-fg">
                    Agents you can run today.
                </h1>
                <p className="mt-5 text-[17px] leading-[1.55] text-fg-muted">
                    Every agent below ships with a default policy bound to the same
                    on-chain verifier. The agent never signs — it submits structured
                    intents to the attested enclave, which signs only when policy and
                    oracle conditions are met.
                </p>
            </header>

            <nav className="mt-12 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
                <div className="flex items-center gap-1.5">
                    {RISK_FILTERS.map((f) => (
                        <button
                            key={f}
                            className="rounded-md px-3 py-1.5 text-[12.5px] font-medium tracking-tight text-fg-muted hover:text-fg hover:bg-bg-surface transition-colors data-[active=true]:text-fg data-[active=true]:bg-bg-surface"
                            data-active={f === "all"}
                            type="button"
                        >
                            {f === "all" ? "All" : f[0]!.toUpperCase() + f.slice(1)}
                        </button>
                    ))}
                </div>
                <p className="text-[12px] text-fg-dim font-mono">
                    {AGENTS.length} agents · attested execution
                </p>
            </nav>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {AGENTS.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                ))}
            </div>

            <section className="mt-24 rounded-xl border border-line bg-bg-surface/40 p-7">
                <h2 className="text-display-3 text-fg">
                    Need your own strategy?
                </h2>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-muted">
                    Soloraa is execution infrastructure, not a closed catalog. Any
                    agent that can produce a structured intent — a swap, transfer,
                    lend, rebalance — can plug into the enclave through the SDK.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                    <a
                        href="/developers"
                        className="inline-flex items-center gap-2 rounded-md h-10 px-4 text-sm font-medium bg-fg text-bg hover:opacity-90"
                    >
                        Read the SDK overview
                    </a>
                    <a
                        href="/docs"
                        className="inline-flex items-center gap-2 rounded-md h-10 px-4 text-sm font-medium border border-line-bright text-fg hover:border-fg-dim"
                    >
                        Integration docs
                    </a>
                </div>
            </section>
        </div>
    );
}
