"use client";

import { motion } from "framer-motion";
import { Lock, ShieldCheck, LayoutList, Hash, KeyRound } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fadeUp, stagger } from "@/lib/motion";
import { cn } from "@/lib/cn";

const GUARANTEES = [
    {
        icon: Hash,
        title: "Replay protection",
        proof: "IntentNonceMismatch · 6018",
        desc: "Every signed intent commits to a wallet nonce that bumps on success. Resubmits with a fresh blockhash hit the program's verifier and bounce.",
    },
    {
        icon: ShieldCheck,
        title: "Enclave verification",
        proof: "Ed25519 sysvar · index − 1",
        desc: "An Ed25519Program ix immediately precedes every execute call. The pubkey must equal wallet.enclave_signer; the message must be the canonical 169 bytes.",
    },
    {
        icon: KeyRound,
        title: "Attested rotation",
        proof: "register_enclave_v2",
        desc: "Signer rotation requires the authority's signature AND a governor proof citing a measurement in the on-chain registry. Neither side alone can hijack.",
    },
    {
        icon: LayoutList,
        title: "CPI allowlist",
        proof: "Policy.allowed_programs[16]",
        desc: "Authority-controlled. Even a perfectly-signed intent cannot CPI into a program the wallet hasn't pre-approved.",
    },
    {
        icon: Lock,
        title: "Fork-resistant binding",
        proof: "SlotHashes lookup",
        desc: "Signed messages bind a (recent_blockhash, slot) pair. The verifier binary-searches the SlotHashes sysvar. Cross-fork replays miss the entry.",
    },
] as const;

export function SecurityCards() {
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
                        <Badge tone="neutral">Guarantees</Badge>
                    </motion.div>
                    <motion.h2
                        variants={fadeUp}
                        className="mt-5 text-display-2 text-balance text-fg"
                    >
                        Constraints checked by the chain, not by the agent.
                    </motion.h2>
                    <motion.p
                        variants={fadeUp}
                        className="mt-5 text-[17px] leading-[1.55] text-fg-muted"
                    >
                        Each guarantee maps to a specific error code in
                        <code className="mx-1 font-mono text-[14px] text-fg-soft">programs/solora/src/error.rs</code>
                        and is exercised by a LiteSVM test. The on-chain program
                        rejects with a typed error you can grep.
                    </motion.p>
                </motion.div>

                <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: "-60px" }}
                    variants={stagger(0.05)}
                    className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                    {GUARANTEES.map((g, i) => (
                        <motion.div
                            key={g.title}
                            variants={fadeUp}
                            className={cn(i === 0 && "lg:col-span-1")}
                        >
                            <Card interactive className="h-full group">
                                <CardBody className="flex flex-col gap-6">
                                    <div className="flex items-center justify-between">
                                        <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-bg-raised text-fg-soft">
                                            <g.icon className="size-[15px]" />
                                        </span>
                                        <code className="font-mono text-[11px] text-fg-dim">
                                            {g.proof}
                                        </code>
                                    </div>
                                    <div>
                                        <h3 className="text-[15px] font-medium text-fg tracking-tight">
                                            {g.title}
                                        </h3>
                                        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
                                            {g.desc}
                                        </p>
                                    </div>
                                </CardBody>
                            </Card>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </section>
    );
}
