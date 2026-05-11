import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CodeBlockProps extends HTMLAttributes<HTMLDivElement> {
    title?: string;
    language?: string;
    children: ReactNode;
}

export function CodeBlock({ title, language = "rust", className, children, ...props }: CodeBlockProps) {
    return (
        <div
            className={cn(
                "rounded-xl border border-line bg-[hsl(var(--bg)/0.6)] overflow-hidden",
                className
            )}
            {...props}
        >
            {title && (
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5 bg-bg-raised/40">
                    <div className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full bg-line-bright" />
                        <span className="size-2.5 rounded-full bg-line-bright" />
                        <span className="size-2.5 rounded-full bg-line-bright" />
                    </div>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-fg-dim">
                        {title}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-fg-dim">
                        {language}
                    </span>
                </div>
            )}
            <pre className="font-mono text-[13px] leading-relaxed text-fg-muted px-5 py-4 overflow-x-auto">
                {children}
            </pre>
        </div>
    );
}

export function InlineCode({ className, ...props }: HTMLAttributes<HTMLElement>) {
    return (
        <code
            className={cn(
                "font-mono text-[0.92em] px-1.5 py-0.5 rounded-md bg-bg-raised/80 border border-line text-fg",
                className
            )}
            {...props}
        />
    );
}
