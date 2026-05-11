"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { INTENT_FIELDS, INTENT_MSG_LEN } from "@/lib/solora";

/**
 * The 169-byte SOLORA_INTENT_V2 message rendered as a contiguous strip. Each
 * field is one neutral block; the field that's currently being "filled" picks
 * up the single accent color. The strip loops every ~8s — that's our only
 * loop and it exists to communicate that the verifier really is reading every
 * one of these bytes.
 *
 * Design call: no gradients on the strip itself. The accent appears as a thin
 * top border above the currently-active segment. Everything else is graphite.
 */

const FILL_DURATION_S = 4.0;
const LOOP_LENGTH_S = 8.0;

export function IntentBytes({ className }: { className?: string }) {
    const prefersReduced = useReducedMotion();
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (prefersReduced) return;
        const id = setInterval(() => setTick((t) => t + 1), LOOP_LENGTH_S * 1000);
        return () => clearInterval(id);
    }, [prefersReduced]);

    return (
        <div className={cn("w-full", className)}>
            <div className="flex items-baseline justify-between text-[10px] font-mono uppercase tracking-[0.16em] text-fg-dim mb-3">
                <span>byte 0</span>
                <span className="text-fg-muted">SOLORA_INTENT_V2 · 169 bytes</span>
                <span>byte 168</span>
            </div>

            <div
                key={tick}
                className="relative h-11 w-full rounded-md overflow-hidden border border-line bg-bg-surface"
            >
                <div className="absolute inset-0 flex">
                    {INTENT_FIELDS.map((field, i) => {
                        const widthPct = (field.length / INTENT_MSG_LEN) * 100;
                        const startPct = (field.offset / INTENT_MSG_LEN) * 100;
                        return (
                            <div
                                key={field.name}
                                style={{ width: `${widthPct}%` }}
                                className={cn(
                                    "relative h-full",
                                    i !== INTENT_FIELDS.length - 1 && "border-r border-bg/80"
                                )}
                            >
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={
                                        prefersReduced ? { opacity: 1 } : { opacity: 1 }
                                    }
                                    transition={
                                        prefersReduced
                                            ? { duration: 0 }
                                            : {
                                                  delay: (startPct / 100) * FILL_DURATION_S,
                                                  duration: 0.2,
                                              }
                                    }
                                    className="absolute inset-0 bg-bg-raised"
                                />
                                <motion.div
                                    initial={{ scaleY: 0 }}
                                    animate={
                                        prefersReduced ? { scaleY: 1 } : { scaleY: 1 }
                                    }
                                    transition={
                                        prefersReduced
                                            ? { duration: 0 }
                                            : {
                                                  delay: (startPct / 100) * FILL_DURATION_S,
                                                  duration: 0.32,
                                                  ease: [0.4, 0, 0.2, 1],
                                              }
                                    }
                                    style={{ transformOrigin: "bottom" }}
                                    className="absolute inset-x-0 top-0 h-px bg-accent"
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-1.5 sm:grid-cols-9">
                {INTENT_FIELDS.map((field) => (
                    <div
                        key={field.name}
                        className="flex items-center gap-1.5 text-[10px] font-mono text-fg-muted"
                        title={`${field.label} — ${field.length} ${field.length === 1 ? "byte" : "bytes"} at offset ${field.offset}`}
                    >
                        <span className="size-1 rounded-full bg-fg-dim shrink-0" />
                        <span className="truncate">{field.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
