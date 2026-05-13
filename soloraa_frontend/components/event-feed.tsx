"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ExecutionEvent } from "@/lib/execution-store";

interface EventFeedProps {
    events: ExecutionEvent[];
    /** Reverse order: newest at top. Defaults to true. */
    newestFirst?: boolean;
}

const stageBadge: Record<string, string> = {
    intent: "INTENT",
    policy: "POLICY",
    oracle: "ORACLE",
    build: "BUILD",
    sign: "SIGN",
    broadcast: "BROADCAST",
    verify: "VERIFY",
};

export function EventFeed({ events, newestFirst = true }: EventFeedProps) {
    const ordered = newestFirst ? [...events].reverse() : events;

    if (events.length === 0) {
        return (
            <div className="flex items-center justify-center h-40 text-[13px] text-fg-dim">
                Run the agent to stream live execution events.
            </div>
        );
    }

    return (
        <ol className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
                {ordered.map((event) => (
                    <motion.li
                        key={event.id}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14, ease: "easeOut" }}
                        className={cn(
                            "rounded-lg border px-4 py-3.5",
                            event.rejected
                                ? "border-danger/40 bg-danger/[0.04]"
                                : "border-line bg-bg-surface/50"
                        )}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                    className={cn(
                                        "inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
                                        event.rejected
                                            ? "border-danger/50 text-danger"
                                            : "border-ok/50 text-ok"
                                    )}
                                >
                                    {event.rejected ? (
                                        <X className="size-3" strokeWidth={2.5} />
                                    ) : (
                                        <Check className="size-3" strokeWidth={2.5} />
                                    )}
                                </span>
                                <p className="text-[13px] sm:text-[13.5px] font-medium text-fg truncate">
                                    {event.title}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 text-fg-dim shrink-0">
                                <span className="hidden sm:inline-flex font-mono text-[10.5px] uppercase tracking-wider">
                                    {stageBadge[event.stage] ?? event.stage}
                                </span>
                                <span className="font-mono text-[11px] mono-num">
                                    {formatTime(event.ts)}
                                </span>
                            </div>
                        </div>
                        {event.detail && (
                            <p className="mt-2 ml-[30px] text-[12.5px] leading-relaxed text-fg-muted">
                                {event.detail}
                            </p>
                        )}
                        {event.code && (
                            <code className="mt-2 ml-[30px] block font-mono text-[11px] sm:text-[11.5px] text-fg-soft break-all">
                                {event.code}
                            </code>
                        )}
                        {event.txSignature && event.explorerUrl && (
                            <a
                                href={event.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 ml-[30px] inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-soft hover:text-fg break-all"
                            >
                                {event.txSignature.slice(0, 10)}…{event.txSignature.slice(-10)} ↗
                            </a>
                        )}
                    </motion.li>
                ))}
            </AnimatePresence>
        </ol>
    );
}

function formatTime(ts: number) {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}
