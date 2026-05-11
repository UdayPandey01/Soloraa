import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, TrendingUp, Wallet, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { PnlChart } from "@/components/pnl-chart";
import { Sparkline } from "@/components/sparkline";
import { AGENTS, formatBps, formatUsdc } from "@/lib/agents";

export const metadata: Metadata = {
    title: "Portfolio",
    description:
        "Cumulative PnL, open positions, and recent executions across all Soloraa agents in your wallet.",
};

// Illustrative cumulative-value series. Real implementation reads
// program.account.soloraWallet.fetch + agent balances.
const PNL_DATA = [
    { day: "May 03", valueUsdc: 24_000 },
    { day: "May 04", valueUsdc: 24_120 },
    { day: "May 05", valueUsdc: 24_340 },
    { day: "May 06", valueUsdc: 24_080 },
    { day: "May 07", valueUsdc: 24_520 },
    { day: "May 08", valueUsdc: 24_900 },
    { day: "May 09", valueUsdc: 25_180 },
    { day: "May 10", valueUsdc: 25_640 },
    { day: "May 11", valueUsdc: 26_010 },
];

const POSITIONS = [
    { agentId: "market-making-sol-usdc", asset: "SOL/USDC", side: "Maker", allocation: 8200, pnl: 184 },
    { agentId: "stablecoin-yield", asset: "USDC → Kamino", side: "Lend", allocation: 12_000, pnl: 96 },
    { agentId: "arbitrage-monitor", asset: "USDC ↔ SOL ↔ USDT", side: "Triangular", allocation: 4500, pnl: 211 },
    { agentId: "dca-allocator", asset: "USDC → SOL", side: "Recurring", allocation: 1500, pnl: 42 },
] as const;

const RECENT = [
    { ts: "10:42:18", agent: "market-making-sol-usdc", action: "Quote refresh", status: "ok" as const },
    { ts: "10:41:02", agent: "arbitrage-monitor", action: "Edge skipped (< floor)", status: "ok" as const },
    { ts: "10:39:55", agent: "stablecoin-yield", action: "Route migration", status: "ok" as const },
    { ts: "10:38:11", agent: "market-making-sol-usdc", action: "Fill: 12.4 SOL", status: "ok" as const },
    { ts: "10:37:40", agent: "market-making-sol-usdc", action: "Replay attempt", status: "rejected" as const },
];

export default function PortfolioPage() {
    const totalAllocation = POSITIONS.reduce((s, p) => s + p.allocation, 0);
    const totalPnl = POSITIONS.reduce((s, p) => s + p.pnl, 0);
    const start = PNL_DATA[0]?.valueUsdc ?? 0;
    const end = PNL_DATA[PNL_DATA.length - 1]?.valueUsdc ?? 0;
    const sinceStart = end - start;
    const sinceStartBps = start > 0 ? Math.round(((end - start) / start) * 10_000) : 0;

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-20 sm:pb-24 lg:pt-20">
            <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-8 sm:pb-10">
                <div>
                    <Badge>Portfolio</Badge>
                    <h1 className="mt-4 sm:mt-5 text-display-2 text-fg">
                        Wallet 3Kh6…KR6N
                    </h1>
                    <p className="mt-2 sm:mt-3 text-[13px] sm:text-[14px] text-fg-muted font-mono">
                        bound to 4 attested agents · governor 7Zk2…fibJ
                    </p>
                </div>
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line w-full sm:w-auto">
                    <Kpi label="Net asset value" value={`${formatUsdc(end)} USDC`} />
                    <Kpi
                        label="Period PnL"
                        value={`+${formatUsdc(sinceStart)} USDC`}
                        sub={formatBps(sinceStartBps)}
                    />
                    <Kpi label="Allocated" value={`${formatUsdc(totalAllocation)} USDC`} />
                </div>
            </header>

            <section className="mt-10 sm:mt-12 grid gap-5 sm:gap-6 lg:grid-cols-[1.6fr_1fr]">
                <Card>
                    <CardBody>
                        <header className="flex items-baseline justify-between">
                            <div>
                                <h2 className="text-[13.5px] font-medium text-fg flex items-center gap-2">
                                    <TrendingUp className="size-4 text-fg-muted" /> Cumulative value
                                </h2>
                                <p className="mt-1 text-[12px] text-fg-muted">
                                    Net of fees · marked at Pyth verified prices.
                                </p>
                            </div>
                            <Badge tone="ok" dotted>
                                live
                            </Badge>
                        </header>
                        <div className="mt-5">
                            <PnlChart data={PNL_DATA} />
                        </div>
                    </CardBody>
                </Card>

                <Card>
                    <CardBody>
                        <h2 className="text-[13.5px] font-medium text-fg flex items-center gap-2">
                            <Wallet className="size-4 text-fg-muted" /> Allocation
                        </h2>
                        <p className="mt-1 text-[12px] text-fg-muted">By active agent.</p>
                        <ul className="mt-5 space-y-3">
                            {POSITIONS.map((p) => {
                                const pct = (p.allocation / totalAllocation) * 100;
                                const agentName =
                                    AGENTS.find((a) => a.id === p.agentId)?.name ?? p.agentId;
                                return (
                                    <li key={p.agentId}>
                                        <div className="flex items-baseline justify-between text-[12.5px]">
                                            <span className="text-fg-soft">{agentName}</span>
                                            <span className="text-fg-muted mono-num">
                                                {pct.toFixed(0)}%
                                            </span>
                                        </div>
                                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-bg-raised">
                                            <div
                                                className="h-full rounded-full bg-fg-soft"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </CardBody>
                </Card>
            </section>

            <section className="mt-10 sm:mt-12">
                <header className="mb-5 flex items-baseline justify-between">
                    <h2 className="text-display-3 text-fg">Open positions</h2>
                    <Link
                        href="/agents"
                        className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-fg"
                    >
                        Add an agent <ArrowUpRight className="size-3.5" />
                    </Link>
                </header>
                <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full text-[13px] min-w-[640px]">
                        <thead className="bg-bg-surface/50 border-b border-line">
                            <tr className="text-left text-fg-dim font-mono text-[11px] uppercase tracking-wider">
                                <th className="px-4 py-3 font-medium">Agent</th>
                                <th className="px-4 py-3 font-medium">Position</th>
                                <th className="px-4 py-3 font-medium text-right">Allocation</th>
                                <th className="px-4 py-3 font-medium text-right">PnL</th>
                                <th className="px-4 py-3 font-medium text-right">Trend</th>
                            </tr>
                        </thead>
                        <tbody>
                            {POSITIONS.map((p, i) => {
                                const agent = AGENTS.find((a) => a.id === p.agentId);
                                return (
                                    <tr
                                        key={p.agentId}
                                        className={i < POSITIONS.length - 1 ? "border-b border-line" : ""}
                                    >
                                        <td className="px-4 py-4">
                                            <Link
                                                href={`/agent/${p.agentId}` as never}
                                                className="text-fg hover:underline"
                                            >
                                                {agent?.name ?? p.agentId}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-4 text-fg-soft">
                                            <span className="font-mono text-[12px]">{p.asset}</span>{" "}
                                            <span className="text-fg-dim text-[11px]">· {p.side}</span>
                                        </td>
                                        <td className="px-4 py-4 text-right mono-num text-fg-soft">
                                            {formatUsdc(p.allocation)}
                                        </td>
                                        <td className="px-4 py-4 text-right mono-num text-ok">
                                            +{formatUsdc(p.pnl)}
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex justify-end">
                                                {agent && (
                                                    <Sparkline
                                                        data={agent.series.slice(-12)}
                                                        width={88}
                                                        height={24}
                                                    />
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="mt-10 sm:mt-12">
                <header className="mb-5">
                    <h2 className="text-display-3 text-fg flex items-center gap-2">
                        <Activity className="size-5 text-fg-muted" /> Recent execution
                    </h2>
                    <p className="mt-2 text-[13.5px] sm:text-[14px] text-fg-muted max-w-2xl">
                        Every line is an attested intent — successful or rejected. Replay
                        attempts surface here with the on-chain error code.
                    </p>
                </header>
                <ul className="rounded-xl border border-line bg-bg-surface/40 divide-y divide-line">
                    {RECENT.map((r, i) => {
                        const agentName =
                            AGENTS.find((a) => a.id === r.agent)?.name ?? r.agent;
                        return (
                            <li
                                key={`${r.ts}-${i}`}
                                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5"
                            >
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                                    <span
                                        className={`mono-num text-[11.5px] ${
                                            r.status === "ok" ? "text-fg-dim" : "text-danger"
                                        }`}
                                    >
                                        {r.ts}
                                    </span>
                                    <span className="text-fg-soft text-[13px]">{r.action}</span>
                                    <span className="text-fg-muted text-[12px]">· {agentName}</span>
                                </div>
                                {r.status === "ok" ? (
                                    <Badge tone="ok">confirmed</Badge>
                                ) : (
                                    <Badge tone="danger">IntentNonceMismatch · 6018</Badge>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="bg-bg-surface px-5 py-4 min-w-[160px]">
            <p className="text-eyebrow text-fg-dim">{label}</p>
            <p className="mt-1.5 mono-num text-[18px] text-fg">{value}</p>
            {sub && <p className="text-[11.5px] text-ok mono-num mt-0.5">{sub}</p>}
        </div>
    );
}
