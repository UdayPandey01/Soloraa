"use client";

import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

interface PnlChartProps {
    /** Array of { day, valueUsdc } points. */
    data: { day: string; valueUsdc: number }[];
}

export function PnlChart({ data }: PnlChartProps) {
    return (
        <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
                    <defs>
                        <linearGradient id="pnl-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(220 100% 74%)" stopOpacity={0.22} />
                            <stop offset="100%" stopColor="hsl(220 100% 74%)" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        stroke="hsl(220 5% 16%)"
                        strokeDasharray="3 3"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="day"
                        stroke="hsl(220 4% 38%)"
                        tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        stroke="hsl(220 4% 38%)"
                        tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
                        tickLine={false}
                        axisLine={false}
                        width={56}
                        tickFormatter={(v) =>
                            v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
                        }
                    />
                    <Tooltip
                        cursor={{ stroke: "hsl(220 5% 22%)" }}
                        contentStyle={{
                            background: "hsl(230 6% 11%)",
                            border: "1px solid hsl(220 5% 22%)",
                            borderRadius: 8,
                            fontSize: 12,
                            color: "hsl(210 8% 96%)",
                            padding: "10px 12px",
                        }}
                        labelStyle={{
                            color: "hsl(220 5% 58%)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            marginBottom: 4,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                        }}
                        formatter={(value: number) => [
                            `${value.toLocaleString()} USDC`,
                            "Net",
                        ]}
                    />
                    <Area
                        type="monotone"
                        dataKey="valueUsdc"
                        stroke="hsl(220 100% 74%)"
                        strokeWidth={1.6}
                        fill="url(#pnl-fill)"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
