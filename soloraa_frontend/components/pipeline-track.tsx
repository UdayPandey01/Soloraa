"use client";

import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { PIPELINE_STAGES } from "@/lib/solora";
import type { StageState } from "@/lib/execution-store";

interface PipelineTrackProps {
    stages: Record<string, StageState>;
    /** Optional rejection label that replaces the "broadcast" stage when set. */
    rejection?: { name: string };
}

/**
 * Vertical pipeline track — 7 named stages, each independently lit by
 * useExecution. Stages stay on screen even when idle so the user can see the
 * full lifecycle they're about to step through.
 */
export function PipelineTrack({ stages, rejection }: PipelineTrackProps) {
    return (
        <ol className="relative">
            {PIPELINE_STAGES.map((stage, idx) => {
                const state = (stages[stage.id] ?? "idle") as StageState;
                const isLast = idx === PIPELINE_STAGES.length - 1;
                const showAsRejection = rejection && state === "rejected";

                return (
                    <li key={stage.id} className="relative flex gap-4 pb-6 last:pb-0">
                        {/* Connector */}
                        {!isLast && (
                            <span
                                aria-hidden="true"
                                className={cn(
                                    "absolute left-[15px] top-[34px] w-px h-[calc(100%-22px)] transition-colors",
                                    state === "ok" || state === "active"
                                        ? "bg-fg-soft"
                                        : "bg-line"
                                )}
                            />
                        )}

                        {/* Node */}
                        <span
                            className={cn(
                                "relative z-10 shrink-0 mt-[1px] grid place-items-center size-8 rounded-full border bg-bg-surface transition-colors",
                                state === "idle" && "border-line text-fg-dim",
                                state === "active" &&
                                    "border-accent text-accent",
                                state === "ok" && "border-ok text-ok",
                                state === "rejected" && "border-danger text-danger"
                            )}
                        >
                            {state === "active" && (
                                <motion.span
                                    animate={{ opacity: [0.4, 1, 0.4] }}
                                    transition={{ duration: 1.4, repeat: Infinity }}
                                    className="size-1.5 rounded-full bg-accent"
                                />
                            )}
                            {state === "ok" && <Check className="size-3.5" strokeWidth={2.4} />}
                            {state === "rejected" && <X className="size-3.5" strokeWidth={2.4} />}
                            {state === "idle" && (
                                <span className="size-1.5 rounded-full bg-fg-dim" />
                            )}
                        </span>

                        {/* Label */}
                        <div className="min-w-0 pt-0.5">
                            <p
                                className={cn(
                                    "text-[13.5px] font-medium tracking-tight",
                                    state === "idle" ? "text-fg-muted" : "text-fg"
                                )}
                            >
                                {showAsRejection ? rejection.name : stage.title}
                            </p>
                            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                                {stage.detail}
                            </p>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
