"use client";

import { motion } from "framer-motion";
import { AlertTriangle, KeyRound, Repeat, Brain } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fadeUp, stagger } from "@/lib/motion";

const FAILURES = [
    {
        icon: KeyRound,
        title: "Hot keys for AI",
        body: "The standard pattern hands an LLM a private key. That key is an unbounded license — every constraint is enforced by whichever process holds it. That isn't a security boundary, it's a code review.",
        tag: "OWNERSHIP",
    },
    {
        icon: Repeat,
        title: "Replayable approvals",
        body: "Session keys with policy guards bolted onto the SDK can be re-broadcast across forks, after slot rollovers, or by a compromised relayer that captured a single signed message.",
        tag: "REPLAY",
    },
    {
        icon: Brain,
        title: "Hallucinated execution",
        body: "Prompt injection, tool-misuse, and model errors regularly produce trades the user never asked for. Without an out-of-process check, the model's mistake reaches the chain.",
        tag: "INTEGRITY",
    },
    {
        icon: AlertTriangle,
        title: "Drift between policy and code",
        body: "Slippage caps, allowlists, oracle freshness — typically all enforced in the same TypeScript that the agent talks to. One refactor and the policy disappears silently.",
        tag: "DRIFT",
    },
] as const;

export function Problem() {
    return (
        <section className="relative py-24 lg:py-32">
            <div className="mx-auto max-w-7xl px-6">
                <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-100px" }}
                    variants={stagger(0.05)}
                    className="max-w-3xl"
                >
                    <motion.div variants={fadeUp}>
                        <Badge tone="danger">The problem</Badge>
                    </motion.div>
                    <motion.h2
                        variants={fadeUp}
                        className="mt-5 text-display-2 text-balance"
                    >
                        Generative agents are about to become financial actors.
                    </motion.h2>
                    <motion.p
                        variants={fadeUp}
                        className="mt-5 text-lg leading-relaxed text-fg-muted"
                    >
                        Today the only way to give an LLM the power to settle a trade,
                        rebalance a treasury, or pay an invoice is to hand it a wallet
                        key. The model becomes the security boundary. That assumption
                        breaks the moment a model is jailbroken, prompt-injected, or
                        simply wrong.
                    </motion.p>
                </motion.div>

                <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-80px" }}
                    variants={stagger(0.07)}
                    className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
                >
                    {FAILURES.map(({ icon: Icon, title, body, tag }) => (
                        <motion.div key={tag} variants={fadeUp}>
                            <Card interactive accent="danger" className="h-full">
                                <CardBody className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between">
                                        <span className="inline-flex size-9 items-center justify-center rounded-lg bg-danger/10 text-danger border border-danger/30">
                                            <Icon className="size-4" />
                                        </span>
                                        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-dim">
                                            {tag}
                                        </span>
                                    </div>
                                    <h3 className="text-base font-medium tracking-tight text-fg">
                                        {title}
                                    </h3>
                                    <p className="text-sm leading-relaxed text-fg-muted">
                                        {body}
                                    </p>
                                </CardBody>
                            </Card>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </section>
    );
}
