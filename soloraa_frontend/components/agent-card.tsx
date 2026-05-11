import Link from "next/link";
import { ArrowUpRight, Activity, Gauge, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Sparkline } from "@/components/sparkline";
import { formatBps, formatCadence, type Agent } from "@/lib/agents";
import { cn } from "@/lib/cn";

const statusTone = {
    live: "ok",
    beta: "warn",
    preview: "neutral",
} as const;

const riskLabel = {
    conservative: "Conservative",
    moderate: "Moderate",
    aggressive: "Aggressive",
} as const;

interface AgentCardProps {
    agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
    return (
        <Link href={`/agent/${agent.id}` as never} className="group block">
            <Card interactive className="h-full">
                <CardBody className="flex h-full flex-col gap-5">
                    <header className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-[15px] font-medium tracking-tight text-fg truncate">
                                    {agent.name}
                                </h3>
                                <Badge tone={statusTone[agent.status]}>
                                    {agent.status}
                                </Badge>
                            </div>
                            <p className="mt-1.5 text-[13px] leading-snug text-fg-muted line-clamp-2">
                                {agent.tagline}
                            </p>
                        </div>
                        <ArrowUpRight className="size-4 shrink-0 text-fg-dim transition-colors group-hover:text-fg" />
                    </header>

                    <div className="flex items-baseline justify-between border-y border-line py-3">
                        <div>
                            <p className="text-eyebrow text-fg-dim">Sim. APY</p>
                            <p className="mt-0.5 mono-num text-[18px] text-fg">
                                {formatBps(agent.simulatedApyBps)}
                            </p>
                        </div>
                        <Sparkline data={agent.series} width={140} height={32} />
                    </div>

                    <dl className="grid grid-cols-3 gap-3 text-[12px]">
                        <Stat
                            icon={<Gauge className="size-3.5" />}
                            label="Risk"
                            value={
                                <span className="flex items-center gap-1.5">
                                    {riskLabel[agent.risk]}
                                    <RiskBars score={agent.riskScore} />
                                </span>
                            }
                        />
                        <Stat
                            icon={<Activity className="size-3.5" />}
                            label="Cadence"
                            value={`~${formatCadence(agent.cadenceSecMedian)}`}
                        />
                        <Stat
                            icon={<Layers className="size-3.5" />}
                            label="Venues"
                            value={`${agent.protocols.length}`}
                        />
                    </dl>
                </CardBody>
            </Card>
        </Link>
    );
}

function Stat({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1.5 text-fg-dim font-mono text-[10.5px] uppercase tracking-wider">
                {icon}
                {label}
            </span>
            <span className="text-fg-soft text-[12.5px]">{value}</span>
        </div>
    );
}

function RiskBars({ score }: { score: number }) {
    return (
        <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((i) => (
                <span
                    key={i}
                    className={cn(
                        "w-[2px] rounded-sm transition-colors",
                        i === 1 && "h-[5px]",
                        i === 2 && "h-[7px]",
                        i === 3 && "h-[9px]",
                        i === 4 && "h-[11px]",
                        i === 5 && "h-[13px]",
                        i <= score ? "bg-fg-soft" : "bg-line-bright"
                    )}
                />
            ))}
        </span>
    );
}
