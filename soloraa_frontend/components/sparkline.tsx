import { cn } from "@/lib/cn";

interface SparklineProps {
    data: readonly number[];
    width?: number;
    height?: number;
    /** "neutral" draws in fg-soft, "accent" in accent. */
    tone?: "neutral" | "accent";
    className?: string;
}

/**
 * Pure SVG sparkline — 0 dependencies, no client work, snaps tight against
 * grid layouts. Range is computed from the data; if range collapses to 0 we
 * draw a flat midline (rendering a zero-variance series).
 */
export function Sparkline({
    data,
    width = 180,
    height = 44,
    tone = "neutral",
    className,
}: SparklineProps) {
    if (data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);

    const points = data.map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return [x, y] as const;
    });

    const path = points
        .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
        .join(" ");

    // Fill area underneath.
    const areaPath =
        `${path} L ${points[points.length - 1]?.[0].toFixed(2)} ${height} L 0 ${height} Z`;

    const strokeClass = tone === "accent" ? "text-accent" : "text-fg-soft";
    const fillClass = tone === "accent" ? "text-accent" : "text-fg-soft";

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            preserveAspectRatio="none"
            className={cn("block", className)}
            aria-hidden="true"
        >
            <path d={areaPath} className={fillClass} fill="currentColor" fillOpacity={0.08} />
            <path
                d={path}
                className={strokeClass}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
