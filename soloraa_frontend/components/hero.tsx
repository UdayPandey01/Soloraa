"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IntentBytes } from "@/components/intent-bytes";
import { fadeUp, stagger, SPRING_GENTLE } from "@/lib/motion";

const PRIMARY_CTA =
    "inline-flex items-center justify-center gap-2 rounded-md h-11 px-5 text-[14px] font-medium tracking-tight bg-fg text-bg transition-[opacity] duration-150 hover:opacity-90";
const SECONDARY_CTA =
    "inline-flex items-center justify-center gap-2 rounded-md h-11 px-5 text-[14px] font-medium tracking-tight bg-bg-surface text-fg border border-line-bright transition-colors duration-150 hover:border-fg-dim";

export function Hero() {
    return (
        <section className="relative isolate">
            <div className="absolute inset-x-0 top-0 h-[500px] grid-overlay pointer-events-none opacity-60" aria-hidden="true" />

            <div className="relative mx-auto max-w-7xl px-6 pt-24 pb-20 lg:pt-32 lg:pb-28">
                <motion.div
                    variants={stagger(0.06)}
                    initial="hidden"
                    animate="visible"
                    className="max-w-4xl"
                >
                    <motion.div variants={fadeUp}>
                        <Badge tone="neutral" dotted>
                            <span className="text-fg-soft">Live · Solana devnet</span>
                        </Badge>
                    </motion.div>

                    <motion.h1
                        variants={fadeUp}
                        className="mt-7 text-display-1 text-balance text-fg"
                    >
                        The cryptographic execution layer for{" "}
                        <span className="text-fg-soft">autonomous AI</span> on Solana.
                    </motion.h1>

                    <motion.p
                        variants={fadeUp}
                        className="mt-7 max-w-2xl text-lg leading-[1.55] text-fg-muted"
                    >
                        Soloraa lets an AI agent hold and move funds under cryptographic
                        boundaries the user controls. Funds live in a program-derived
                        wallet that only accepts Ed25519-signed intents from a
                        TEE-attested enclave. Compromise the agent and you get nothing.
                    </motion.p>

                    <motion.div
                        variants={fadeUp}
                        className="mt-10 flex flex-wrap items-center gap-3"
                    >
                        <Link href="/agents" className={PRIMARY_CTA}>
                            Browse agents <ArrowRight className="size-4" />
                        </Link>
                        <Link href="/replay-demo" className={SECONDARY_CTA}>
                            <ShieldCheck className="size-4" /> See replay rejection
                        </Link>
                    </motion.div>

                    <motion.div
                        variants={fadeUp}
                        className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-fg-dim"
                    >
                        <CertLine label="Ed25519" detail="precompile-verified on-chain" />
                        <CertLine label="Wormhole + Pyth" detail="real guardian quorum" />
                        <CertLine label="AWS Nitro / Marlin" detail="attestation-gated rotation" />
                    </motion.div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING_GENTLE, delay: 0.3 }}
                    className="mt-20 lg:mt-24"
                >
                    <div className="rounded-xl border border-line bg-bg-surface/60 p-6 lg:p-7">
                        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
                            <div>
                                <p className="text-eyebrow text-fg-dim">canonical signed intent</p>
                                <p className="mt-1.5 text-[15px] text-fg-soft leading-snug max-w-xl">
                                    Every byte is bound to a wallet, a nonce, and a
                                    recent blockhash. The chain re-checks all of them.
                                </p>
                            </div>
                            <code className="font-mono text-[11px] text-fg-dim shrink-0">
                                programs/solora/src/state.rs
                            </code>
                        </div>
                        <IntentBytes />
                    </div>
                </motion.div>
            </div>
        </section>
    );
}

function CertLine({ label, detail }: { label: string; detail: string }) {
    return (
        <span className="inline-flex items-center gap-2">
            <span className="size-1 rounded-full bg-fg-muted" />
            <span className="font-medium text-fg-soft">{label}</span>
            <span className="text-fg-muted">{detail}</span>
        </span>
    );
}
