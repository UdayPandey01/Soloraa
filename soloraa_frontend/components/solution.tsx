"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { Bot, ShieldCheck, FileSignature, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fadeUp, stagger, SPRING_GENTLE } from "@/lib/motion";

const STAGES = [
    {
        id: "agent",
        icon: Bot,
        title: "AI agent",
        sub: "submits an intent",
        detail: "destination · amount · feed id · slippage cap",
    },
    {
        id: "enclave",
        icon: Cpu,
        title: "Attested enclave",
        sub: "policy + oracle + sign",
        detail: "Pyth merkle · Wormhole quorum · sealed Ed25519 key",
    },
    {
        id: "intent",
        icon: FileSignature,
        title: "Signed intent",
        sub: "169 canonical bytes",
        detail: "program · wallet · nonce · blockhash · payload hash",
    },
    {
        id: "chain",
        icon: ShieldCheck,
        title: "On-chain verifier",
        sub: "re-checks every byte",
        detail: "Ed25519 sysvar · SlotHashes · nonce bump",
    },
] as const;

export function Solution() {
    const prefersReduced = useReducedMotion();
    const [active, setActive] = useState(0);

    useEffect(() => {
        if (prefersReduced) return;
        const id = setInterval(() => setActive((a) => (a + 1) % STAGES.length), 2400);
        return () => clearInterval(id);
    }, [prefersReduced]);

    return (
        <section className="relative py-28 lg:py-36 border-t border-line">
            <div className="mx-auto max-w-7xl px-6">
                <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-80px" }}
                    variants={stagger(0.04)}
                    className="max-w-3xl"
                >
                    <motion.div variants={fadeUp}>
                        <Badge tone="neutral">Architecture</Badge>
                    </motion.div>
                    <motion.h2
                        variants={fadeUp}
                        className="mt-5 text-display-2 text-balance text-fg"
                    >
                        Move the security boundary into Solana.
                    </motion.h2>
                    <motion.p
                        variants={fadeUp}
                        className="mt-5 text-[17px] leading-[1.55] text-fg-muted"
                    >
                        The agent never holds a private key. A confidential-compute
                        enclave holds a signing key sealed to its image hash and runs
                        the policy. The Solana program is the verifier — every
                        constraint is checked against the bytes of the signed intent.
                    </motion.p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ duration: 0.5 }}
                    className="mt-14"
                >
                    <div className="rounded-xl border border-line bg-bg-surface/40 p-6 lg:p-8">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {STAGES.map((stage, idx) => (
                                <Stage
                                    key={stage.id}
                                    stage={stage}
                                    active={active === idx}
                                    index={idx}
                                />
                            ))}
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}

interface StageProps {
    stage: (typeof STAGES)[number];
    active: boolean;
    index: number;
}

function Stage({ stage, active, index }: StageProps) {
    const Icon = stage.icon;
    return (
        <motion.div
            animate={{
                backgroundColor: active
                    ? "hsl(var(--bg-raised) / 1)"
                    : "hsl(var(--bg-surface) / 0.4)",
            }}
            transition={SPRING_GENTLE}
            className="relative rounded-lg border border-line p-5"
        >
            {/* Top accent rail — only on active stage. */}
            <motion.span
                animate={{ opacity: active ? 1 : 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-x-3 top-0 h-px bg-accent"
            />
            <div className="flex items-start justify-between">
                <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-bg-raised text-fg-soft">
                    <Icon className="size-[15px]" />
                </span>
                <span className="font-mono text-[11px] text-fg-dim">0{index + 1}</span>
            </div>
            <h3 className="mt-5 text-[15px] font-medium text-fg tracking-tight">
                {stage.title}
            </h3>
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-fg-dim font-mono">
                {stage.sub}
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
                {stage.detail}
            </p>
        </motion.div>
    );
}
