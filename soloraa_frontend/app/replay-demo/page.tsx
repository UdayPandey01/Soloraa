"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, RotateCcw, ShieldCheck, X, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { CodeBlock, InlineCode } from "@/components/ui/code";
import { cn } from "@/lib/cn";

type Phase = "idle" | "executing" | "executed" | "replaying" | "rejected";

/**
 * Standalone replay-attack demo. Self-contained — no Zustand, no API calls,
 * no agent context. The phase machine intentionally takes ~3s end-to-end so
 * the visual sequence has time to land for a watching judge.
 */
export default function ReplayDemoPage() {
    const [phase, setPhase] = useState<Phase>("idle");
    const [nonce, setNonce] = useState(0);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    const reset = () => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setPhase("idle");
        setNonce(0);
    };

    const start = useCallback(() => {
        reset();
        setPhase("executing");
        timers.current.push(
            setTimeout(() => {
                setNonce(1);
                setPhase("executed");
            }, 1400)
        );
    }, []);

    const replay = useCallback(() => {
        setPhase("replaying");
        timers.current.push(
            setTimeout(() => {
                setPhase("rejected");
            }, 1200)
        );
    }, []);

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-20 sm:pb-24 lg:pt-20">
            <header className="max-w-3xl">
                <Badge tone="danger" dotted>
                    Threat demo
                </Badge>
                <h1 className="mt-5 text-display-2 text-fg text-balance">
                    A captured signature shouldn't move money twice.
                </h1>
                <p className="mt-5 text-[17px] leading-[1.55] text-fg-muted">
                    A compromised relayer, a man-in-the-middle, an old log archive — any
                    of them can resurface a previously-valid signed intent. Soloraa binds
                    each signature to the wallet's nonce. The chain checks. The chain
                    rejects.
                </p>
            </header>

            <section className="mt-10 sm:mt-12 grid gap-5 sm:gap-6 lg:grid-cols-[1fr_320px]">
                <Card>
                    <CardBody className="space-y-6">
                        <header className="flex items-baseline justify-between border-b border-line pb-4">
                            <h2 className="text-[13.5px] font-medium text-fg">
                                Wallet 3Kh6…KR6N
                            </h2>
                            <p className="font-mono text-[11.5px] text-fg-dim">
                                program DfPL…1Ttf · devnet
                            </p>
                        </header>

                        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
                            <Stat label="wallet.nonce" value={String(nonce)} accent={phase === "executed" || phase === "rejected" ? "ok" : "none"} />
                            <Stat label="signed intent nonce" value={phase === "idle" ? "—" : "0"} />
                            <Stat
                                label="status"
                                value={
                                    phase === "rejected"
                                        ? "rejected"
                                        : phase === "executed"
                                          ? "confirmed"
                                          : phase === "idle"
                                            ? "ready"
                                            : "in-flight"
                                }
                                accent={
                                    phase === "rejected"
                                        ? "danger"
                                        : phase === "executed"
                                          ? "ok"
                                          : "none"
                                }
                            />
                        </div>

                        <ol className="space-y-3">
                            <Step
                                index="01"
                                title="Sign and broadcast a transfer"
                                active={phase === "executing"}
                                done={phase !== "idle" && phase !== "executing"}
                                showHash={phase !== "idle"}
                                detail="Enclave signs the canonical 169-byte message. Relayer prepends the Ed25519 verify ix and broadcasts."
                            />
                            <Step
                                index="02"
                                title={
                                    phase === "rejected"
                                        ? "Replay rejected on-chain"
                                        : "Replay the same signed bytes"
                                }
                                active={phase === "replaying"}
                                done={phase === "rejected"}
                                rejected={phase === "rejected"}
                                detail={
                                    phase === "rejected"
                                        ? "Verifier compared signed nonce (0) against wallet.nonce (1). Mismatched. Refused."
                                        : "Resubmit the captured intent with a fresh blockhash to dodge Solana's tx-dedup. Reaches the program."
                                }
                            />
                        </ol>

                        <AnimatePresence>
                            {phase === "rejected" && (
                                <motion.div
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="rounded-lg border border-danger/40 bg-danger/[0.06] px-5 py-4"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-danger/15 text-danger">
                                            <X className="size-3.5" strokeWidth={2.5} />
                                        </span>
                                        <h3 className="text-[14px] font-medium text-fg">
                                            IntentNonceMismatch
                                        </h3>
                                        <code className="font-mono text-[11px] text-danger">
                                            error 6018
                                        </code>
                                    </div>
                                    <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
                                        Autonomous execution cannot be replayed or mutated.
                                        Every signed intent commits to the wallet's nonce at
                                        signing time. Once executed, the nonce moves forward
                                        and the old signature is permanently dead.
                                    </p>
                                    <code className="mt-3 inline-block font-mono text-[11px] text-fg-dim">
                                        programs/solora/src/verify.rs:78
                                    </code>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </CardBody>
                </Card>

                <Card>
                    <CardBody className="space-y-4">
                        <h3 className="text-[13.5px] font-medium text-fg">Controls</h3>
                        <p className="text-[12.5px] leading-relaxed text-fg-muted">
                            Each run uses fresh state. The replay button only enables once
                            the first transfer has confirmed.
                        </p>
                        <div className="grid gap-2 pt-2">
                            <Button
                                onClick={start}
                                disabled={phase === "executing" || phase === "replaying"}
                                className="w-full"
                            >
                                <Play className="size-4" />{" "}
                                {phase === "idle" ? "Sign and broadcast" : "Restart"}
                            </Button>
                            <Button
                                onClick={replay}
                                disabled={phase !== "executed"}
                                variant="danger"
                                className="w-full"
                            >
                                <ShieldCheck className="size-4" /> Replay same intent
                            </Button>
                            <Button
                                onClick={reset}
                                disabled={phase === "idle"}
                                variant="secondary"
                                className="w-full"
                            >
                                <RotateCcw className="size-4" /> Reset
                            </Button>
                        </div>
                    </CardBody>
                </Card>
            </section>

            <section className="mt-10 sm:mt-12">
                <h2 className="text-display-3 text-fg">What the chain actually does</h2>
                <p className="mt-3 text-[14px] text-fg-muted max-w-3xl">
                    The replay-rejection path doesn't depend on anything off-chain. The
                    Anchor program's verifier reads the on-chain nonce and the signed
                    nonce. They don't match. The program returns a typed error before
                    funds move.
                </p>
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <CodeBlock title="programs/solora/src/verify.rs" language="rust">
{`let on_chain_nonce = wallet.load()?.nonce;
let signed_nonce = msg.read_u64(80);   // bytes 80..88

require!(
    signed_nonce == on_chain_nonce,
    ErrorCode::IntentNonceMismatch,
);

// only after the gate: bump the nonce.
wallet.load_mut()?.nonce += 1;`}
                    </CodeBlock>
                    <CodeBlock title="solora_relayer/ops.ts (replay)" language="ts">
{`// Build a fresh wrapping tx but reuse the exact signed
// bytes from the previous run.
const replayTx = new web3.Transaction().add(...tx.instructions);
replayTx.feePayer = authority.publicKey;
replayTx.recentBlockhash = (
  await connection.getLatestBlockhash("confirmed")
).blockhash;
replayTx.sign(authority);

// Solana dedup misses it (different sig). The program catches it.
// AnchorError thrown in programs/solora/src/verify.rs:78
// Error Code: IntentNonceMismatch. Error Number: 6018.`}
                    </CodeBlock>
                </div>
            </section>

            <section className="mt-10 sm:mt-12 rounded-xl border border-line bg-bg-surface/40 p-6 sm:p-8">
                <h3 className="text-[15px] font-medium text-fg">Why this matters</h3>
                <p className="mt-3 text-[14px] leading-[1.6] text-fg-muted max-w-3xl">
                    Most "AI agent wallets" enforce policy at the SDK layer. A captured
                    signature can be reused as long as you can convince the SDK to
                    process it. Soloraa moves the gate onto Solana — the on-chain program
                    is the verifier, and there's no SDK to convince. The same property
                    rules out cross-fork replay, slot-skewed replay, and{" "}
                    <InlineCode>--no-preflight</InlineCode> replay.
                </p>
            </section>
        </div>
    );
}

function Stat({
    label,
    value,
    accent = "none",
}: {
    label: string;
    value: string;
    accent?: "none" | "ok" | "danger";
}) {
    return (
        <div className="bg-bg-surface px-4 py-3">
            <p className="text-eyebrow text-fg-dim">{label}</p>
            <p
                className={cn(
                    "mt-1 mono-num text-[16px]",
                    accent === "ok" && "text-ok",
                    accent === "danger" && "text-danger",
                    accent === "none" && "text-fg"
                )}
            >
                {value}
            </p>
        </div>
    );
}

function Step({
    index,
    title,
    detail,
    active,
    done,
    rejected,
    showHash,
}: {
    index: string;
    title: string;
    detail: string;
    active?: boolean;
    done?: boolean;
    rejected?: boolean;
    showHash?: boolean;
}) {
    const Icon = rejected ? X : Check;
    return (
        <li
            className={cn(
                "flex gap-4 rounded-lg border px-4 py-3.5 transition-colors",
                rejected
                    ? "border-danger/40 bg-danger/[0.04]"
                    : done
                      ? "border-ok/40 bg-ok/[0.03]"
                      : active
                        ? "border-accent/50 bg-bg-raised"
                        : "border-line bg-bg-surface/50"
            )}
        >
            <div className="shrink-0 pt-0.5">
                <span
                    className={cn(
                        "inline-flex size-7 items-center justify-center rounded-full border",
                        rejected
                            ? "border-danger/50 text-danger"
                            : done
                              ? "border-ok/50 text-ok"
                              : active
                                ? "border-accent/60 text-accent"
                                : "border-line text-fg-dim"
                    )}
                >
                    {done || rejected ? (
                        <Icon className="size-3.5" strokeWidth={2.4} />
                    ) : (
                        <span className="font-mono text-[10px]">{index}</span>
                    )}
                </span>
            </div>
            <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-fg">{title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                    {detail}
                </p>
                {showHash && (
                    <code className="mt-2 inline-block font-mono text-[11px] text-fg-dim break-all">
                        5D61rZDWJgRCbCqbAWJAM3LD1mVKaNiXp1Mu5jf1jpfVU8TNnC96iFMsPYj8daPPG6h9ddTnEY1qmxskaRtUt6QF
                    </code>
                )}
            </div>
        </li>
    );
}
