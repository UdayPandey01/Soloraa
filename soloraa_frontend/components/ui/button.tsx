import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
}

const variantStyles: Record<Variant, string> = {
    primary: "bg-fg text-bg hover:opacity-90",
    secondary:
        "bg-bg-surface text-fg border border-line-bright hover:border-fg-dim hover:bg-bg-raised",
    ghost: "text-fg-muted hover:text-fg hover:bg-bg-surface",
    danger:
        "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/15",
};

const sizeStyles: Record<Size, string> = {
    sm: "h-8 px-3 text-[12.5px]",
    md: "h-10 px-4 text-sm",
    lg: "h-11 px-5 text-[14px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { className, variant = "primary", size = "md", ...props },
    ref
) {
    return (
        <button
            ref={ref}
            className={cn(
                "inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-tight transition-[opacity,colors] duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
                variantStyles[variant],
                sizeStyles[size],
                className
            )}
            {...props}
        />
    );
});
