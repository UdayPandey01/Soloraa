import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    interactive?: boolean;
    accent?: "accent" | "ok" | "danger" | "none";
}

const accentMap = {
    accent: "hover:border-accent/40",
    ok: "hover:border-ok/40",
    danger: "hover:border-danger/40",
    none: "hover:border-line-bright",
} as const;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
    { className, interactive, accent = "none", ...props },
    ref
) {
    return (
        <div
            ref={ref}
            className={cn(
                "relative rounded-xl border border-line bg-bg-surface/50",
                interactive && "transition-colors duration-200",
                interactive && accentMap[accent],
                className
            )}
            {...props}
        />
    );
});

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("px-6 pt-6", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("px-6 py-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("px-6 pb-6 pt-3 border-t border-line/60", className)}
            {...props}
        />
    );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
    return (
        <h3
            className={cn("text-base font-medium tracking-tight text-fg", className)}
            {...props}
        />
    );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
    return (
        <p
            className={cn("text-sm leading-relaxed text-fg-muted", className)}
            {...props}
        />
    );
}
