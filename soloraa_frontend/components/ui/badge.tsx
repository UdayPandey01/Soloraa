import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    tone?: Tone;
    dotted?: boolean;
}

const toneStyles: Record<Tone, string> = {
    neutral: "bg-bg-raised text-fg-soft border-line-bright",
    accent: "bg-accent/10 text-accent border-accent/30",
    ok: "bg-ok/10 text-ok border-ok/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    danger: "bg-danger/10 text-danger border-danger/30",
};

const dotStyles: Record<Tone, string> = {
    neutral: "bg-fg-muted",
    accent: "bg-accent",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
};

export function Badge({
    tone = "neutral",
    dotted,
    className,
    children,
    ...props
}: BadgeProps) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10.5px] font-medium tracking-[0.12em] uppercase",
                toneStyles[tone],
                className
            )}
            {...props}
        >
            {dotted && (
                <span
                    className={cn("size-1 rounded-full animate-pulse-soft", dotStyles[tone])}
                />
            )}
            {children}
        </span>
    );
}
