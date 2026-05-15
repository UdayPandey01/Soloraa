"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { AGENTS } from "@/lib/agents";
import { CustomCursor } from "@/components/landing/custom-cursor";

const OPENING_LS_KEY = "solora.opening.v2.seen";
const OPENING_MS = 2400;

export default function LandingPage() {
    const [openingDone, setOpeningDone] = useState<boolean | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const seen = window.localStorage.getItem(OPENING_LS_KEY);
        setOpeningDone(Boolean(seen));
    }, []);

    useEffect(() => {
        if (openingDone === false) {
            const t = setTimeout(() => {
                window.localStorage.setItem(OPENING_LS_KEY, "1");
                setOpeningDone(true);
            }, OPENING_MS);
            return () => clearTimeout(t);
        }
    }, [openingDone]);

    if (openingDone === null) {
        return <div className="landing min-h-screen" aria-hidden />;
    }

    return (
        <div className="landing relative">
            <CustomCursor />
            <AnimatePresence mode="wait">
                {!openingDone && <OpeningSequence key="open" />}
            </AnimatePresence>

            {openingDone && (
                <>
                    <Hero />
                    <Marquee />
                    <ProblemAct />
                    <DeletedKeyAct />
                    <ArchitectureAct />
                    <AgentsTeaser />
                    <ClosingCTA />
                </>
            )}
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

function OpeningSequence() {
    return (
        <motion.div
            className="fixed inset-0 z-[100] bg-ink flex items-center justify-center grain overflow-hidden"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }}
        >
            <div className="absolute inset-0">
                <div className="landing-mesh">
                    <span className="mesh-coral" />
                    <span className="mesh-cream" />
                    <span className="mesh-indigo" />
                </div>
            </div>
            <div className="relative text-center px-6">
                <motion.p
                    initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0)" }}
                    transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                    className="font-mono text-[11px] tracking-[0.4em] uppercase text-cream-dim"
                >
                    SOLORA_INTENT_V2 · 169 BYTES · loaded
                </motion.p>
                <motion.h1
                    initial={{ opacity: 0, y: 24, filter: "blur(20px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0)" }}
                    transition={{ duration: 1.4, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="font-display mt-5 text-[clamp(64px,12vw,200px)] leading-[0.95] text-cream tracking-tight"
                >
                    Solora
                </motion.h1>
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.9, delay: 1.1 }}
                    className="mt-3 text-cream-soft text-[14px]"
                >
                    <em className="font-display italic">cryptographic execution</em> for autonomous AI
                </motion.p>
            </div>
        </motion.div>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

function Hero() {
    const ref = useRef<HTMLElement>(null);
    const { scrollYProgress } = useScroll({
        target: ref,
        offset: ["start start", "end start"],
    });
    const heroY = useTransform(scrollYProgress, [0, 1], [0, -120]);
    const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

    const [parallax, setParallax] = useState({ x: 0, y: 0 });
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            const x = (e.clientX / window.innerWidth - 0.5) * 2;
            const y = (e.clientY / window.innerHeight - 0.5) * 2;
            setParallax({ x, y });
        };
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
    }, []);

    return (
        <section
            ref={ref}
            className="relative min-h-screen flex items-center justify-center overflow-hidden grain bg-ink"
        >
            {/* Animated mesh background. */}
            <div className="landing-mesh" aria-hidden>
                <span
                    className="mesh-coral"
                    style={{
                        transform: `translate3d(${parallax.x * 30}px, ${parallax.y * 30}px, 0)`,
                    }}
                />
                <span
                    className="mesh-cream"
                    style={{
                        transform: `translate3d(${parallax.x * -20}px, ${parallax.y * -20}px, 0)`,
                    }}
                />
                <span className="mesh-indigo" />
            </div>

            {/* Hero asset — video on desktop (with poster fallback to the still),
                still-image on mobile (where autoplay-loop is unreliable + saves
                bandwidth). The transform crops the Veo watermark off the bottom
                of the video; the corner gradient below is a safety net. */}
            <video
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                poster="/obsidian.png"
                className="hidden md:block absolute inset-0 w-full h-full object-cover opacity-55 pointer-events-none"
                style={{
                    transform: "scale(1.08) translate(2.5%, 3%)",
                    transformOrigin: "center center",
                }}
            >
                <source src="/videomp_.mp4" type="video/mp4" />
            </video>
            <img
                src="/obsidian.png"
                alt=""
                className="md:hidden absolute inset-0 w-full h-full object-cover opacity-55 pointer-events-none"
                style={{
                    transform: "scale(1.06) translate(2.5%, 3%)",
                    transformOrigin: "center center",
                }}
            />
            {/* Watermark cover — fades the bottom-right corner into ink, just
                in case the transform crop leaves any sliver of the Veo logo. */}
            <div
                aria-hidden
                className="absolute right-0 bottom-0 w-[260px] h-[110px] pointer-events-none z-[2]"
                style={{
                    background:
                        "radial-gradient(ellipse at bottom right, hsl(var(--ink)) 0%, hsl(var(--ink) / 0.85) 35%, transparent 75%)",
                }}
            />

            <motion.div
                style={{ y: heroY, opacity: heroOpacity }}
                className="relative z-10 mx-auto max-w-7xl w-full px-4 sm:px-6"
            >
                <div className="grid lg:grid-cols-[1.55fr_1fr] gap-10 items-end">
                    <div>
                        <motion.p
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1, duration: 0.7 }}
                            className="inline-flex items-center gap-2 rounded-full border border-cream/15 bg-cream/5 px-3 py-1 font-mono text-[11px] tracking-[0.16em] uppercase text-cream-soft"
                        >
                            <span className="inline-flex size-1.5 rounded-full bg-coral animate-pulse" />
                            Live on Solana · devnet
                        </motion.p>

                        <motion.h1
                            initial={{ opacity: 0, y: 30, filter: "blur(20px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0)" }}
                            transition={{ duration: 1.0, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
                            className="mt-6 font-display text-[clamp(56px,11vw,180px)] leading-[0.92] tracking-tight text-cream"
                            style={{
                                transform: `translate3d(${parallax.x * -8}px, ${parallax.y * -6}px, 0)`,
                            }}
                        >
                            An agent that
                            <br />
                            <em className="italic text-coral">never holds</em>
                            <br />
                            the key.
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.6, duration: 0.7 }}
                            className="mt-7 max-w-xl text-[16px] sm:text-[17px] leading-[1.6] text-cream-soft"
                        >
                            Solora is the cryptographic execution layer for autonomous AI on
                            Solana. The agent proposes; an attested enclave signs; the chain
                            re-verifies <span className="font-mono text-coral">every byte</span>{" "}
                            before funds move.
                        </motion.p>

                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.85, duration: 0.7 }}
                            className="mt-9 flex flex-wrap items-center gap-3"
                        >
                            <MagneticLink href="/agents" primary>
                                Run an agent <ArrowRight className="size-4" />
                            </MagneticLink>
                            <MagneticLink href="/developers">
                                Read the architecture
                            </MagneticLink>
                        </motion.div>
                    </div>

                    {/* Right column — a single editorial pull-quote that grounds the image. */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.0, duration: 0.9 }}
                        className="hidden lg:block self-end pb-2"
                    >
                        <div className="border-l border-cream/20 pl-6">
                            <p className="font-display italic text-[22px] leading-[1.35] text-cream">
                                “If the model is jailbroken, the wallet drains.
                                We built the alternative.”
                            </p>
                            <p className="mt-4 font-mono text-[11px] tracking-[0.16em] uppercase text-cream-dim">
                                — the design principle
                            </p>
                        </div>
                    </motion.div>
                </div>
            </motion.div>

            {/* Scroll cue */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.3, duration: 0.6 }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-cream-dim"
            >
                <span className="font-mono text-[10px] tracking-[0.32em] uppercase">scroll</span>
                <span className="w-px h-10 bg-cream/30 animate-pulse" />
            </motion.div>
        </section>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

function Marquee() {
    const items = [
        "TEE-attested signing",
        "169-byte intents",
        "instructions sysvar verify",
        "SlotHashes binding",
        "Marlin Oyster CVM",
        "Pyth Hermes mid",
        "Solana mainnet bound",
        "Squads-friendly governor",
    ];
    const row = [...items, ...items];
    return (
        <div className="border-y border-cream/10 overflow-hidden bg-ink-rise py-4 select-none">
            <div className="marquee whitespace-nowrap">
                {row.map((s, i) => (
                    <span
                        key={i}
                        className="inline-flex items-center gap-3 font-mono text-[12px] tracking-[0.18em] uppercase text-cream-soft"
                    >
                        {s}
                        <span className="text-coral">◆</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

function ProblemAct() {
    return (
        <Reveal>
            <section className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-32 pb-24 sm:pt-44 sm:pb-32">
                <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-coral">
                    Act I — the problem
                </p>
                <h2 className="mt-6 font-display text-[clamp(40px,7vw,96px)] leading-[1.0] tracking-tight text-cream">
                    Every agent today
                    <br />
                    is <em className="italic">a hot key</em> behind
                    <br />
                    a polite policy class.
                </h2>
                <div className="mt-12 grid gap-10 md:grid-cols-[1.2fr_1fr] items-start">
                    <p className="text-[17px] leading-[1.65] text-cream-soft max-w-xl">
                        Session keys. SDK guards. Middleware allowlists. Every "agent wallet"
                        on the market enforces its rules <em>inside the process that holds
                        the private key</em>. If the model is jailbroken, prompt-injected,
                        or simply wrong, the wallet drains. That isn't a security boundary —
                        it's a code review under load.
                    </p>
                    <div className="rounded-xl border border-cream/15 bg-cream/[0.02] p-5">
                        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-cream-dim">
                            shape of the failure
                        </p>
                        <code className="mt-4 block font-mono text-[12.5px] text-cream-soft leading-[1.7]">
                            <span className="text-coral">await</span> agent.<span className="text-cream">sendTransaction</span>(<span className="text-cream-dim">{"{"}</span>
                            <br />
                            &nbsp;&nbsp;to: <span className="text-cream">prompt</span>,
                            <br />
                            &nbsp;&nbsp;amount: <span className="text-cream">prompt</span>,
                            <br />
                            <span className="text-cream-dim">{"}"}</span>); <span className="text-cream-dim">// 🤞</span>
                        </code>
                    </div>
                </div>
            </section>
        </Reveal>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

function DeletedKeyAct() {
    return (
        <Reveal>
            <section className="relative mx-auto max-w-6xl px-4 sm:px-6 py-24 sm:py-32">
                <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-coral">
                    Act II — the move
                </p>
                <h2 className="mt-6 font-display text-[clamp(40px,7vw,96px)] leading-[1.0] tracking-tight text-cream">
                    We <em className="italic">deleted</em> the
                    <br />
                    key.
                </h2>
                <div className="mt-12 grid gap-8 sm:grid-cols-3">
                    <Step
                        n="01"
                        title="The agent has nothing."
                        body="No keypair. No KMS. No signing privileges anywhere in its runtime. It can talk to the enclave, that's it."
                    />
                    <Step
                        n="02"
                        title="The enclave signs."
                        body="A sealed Ed25519 key inside a TEE-attested CVM. The image hash is registered on-chain; rotation requires a governor co-signature."
                    />
                    <Step
                        n="03"
                        title="The chain re-verifies."
                        body="Solana reads the Ed25519 ix from the sysvar and re-checks every field — nonce, expiry, blockhash, payload hash, allowlist."
                    />
                </div>

                <p className="mt-14 max-w-2xl text-[17px] leading-[1.65] text-cream-soft">
                    Compromise the agent — <em className="italic">nothing</em>. Compromise the
                    relayer — <em className="italic">nothing</em>. Compromise the enclave
                    binary, and the on-chain measurement registry rejects it on the next
                    rotation. The boundary is{" "}
                    <span className="text-coral">arithmetic</span>, not vigilance.
                </p>
            </section>
        </Reveal>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

function ArchitectureAct() {
    return (
        <Reveal>
            <section className="relative mx-auto max-w-6xl px-4 sm:px-6 py-24 sm:py-32">
                <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-coral">
                    Act III — the trust stack
                </p>
                <h2 className="mt-6 font-display text-[clamp(36px,6vw,80px)] leading-[1.05] tracking-tight text-cream">
                    Three keys.
                    <br />
                    <em className="italic">Three layers.</em>
                </h2>

                <div className="mt-12 divide-y divide-cream/10 border-y border-cream/10">
                    <KeyRow
                        idx="01"
                        name="Session key"
                        place="In your browser, in memory only."
                        does="Submits strategy intents to the enclave."
                        compromise="Nothing. The enclave still refuses any intent outside policy."
                    />
                    <KeyRow
                        idx="02"
                        name="Enclave key"
                        place="Sealed to the TEE image hash. Never leaves."
                        does="Signs the 169-byte SOLORA_INTENT_V2 message."
                        compromise="Nonces still bind. Replays still fail. Measurement is revocable."
                    />
                    <KeyRow
                        idx="03"
                        name="Governor key"
                        place="Off-chain. Hardware-wallet multisig in production."
                        does="Owns the measurement registry. Rotates enclave signers."
                        compromise="The last line. Hardened with timelock + Squads multisig."
                    />
                </div>
            </section>
        </Reveal>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

function AgentsTeaser() {
    const live = AGENTS.filter((a) => a.status === "live").slice(0, 4);
    return (
        <Reveal>
            <section className="relative mx-auto max-w-6xl px-4 sm:px-6 py-24 sm:py-32">
                <div className="flex items-end justify-between gap-6 flex-wrap">
                    <div>
                        <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-coral">
                            running tonight
                        </p>
                        <h2 className="mt-4 font-display text-[clamp(36px,6vw,80px)] leading-[1.0] tracking-tight text-cream">
                            Live <em className="italic">on devnet.</em>
                        </h2>
                    </div>
                    <Link
                        href="/agents"
                        data-cursor="link"
                        className="group inline-flex items-center gap-2 text-cream-soft hover:text-cream transition-colors"
                    >
                        All agents{" "}
                        <ArrowUpRight className="size-4 group-hover:rotate-12 transition-transform" />
                    </Link>
                </div>

                <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    {live.map((agent, i) => (
                        <Link
                            href={{ pathname: `/agent/${agent.id}` }}
                            key={agent.id}
                            data-cursor="link"
                            className="group relative block rounded-2xl border border-cream/12 bg-cream/[0.02] p-5 hover:bg-cream/[0.04] hover:border-coral/40 transition-all duration-500"
                            style={{ transitionDelay: `${i * 40}ms` }}
                        >
                            <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-cream-dim">
                                {agent.risk}
                            </p>
                            <h3 className="mt-4 font-display text-[28px] leading-tight text-cream">
                                {agent.name}
                            </h3>
                            <p className="mt-3 text-[13px] leading-[1.6] text-cream-soft min-h-[64px]">
                                {agent.tagline}
                            </p>
                            <div className="mt-5 flex items-center justify-between font-mono text-[11px] text-cream-dim">
                                <span>
                                    sim · {(agent.simulatedApyBps / 100).toFixed(1)}% apy
                                </span>
                                <ArrowRight className="size-3.5 -rotate-45 group-hover:rotate-0 group-hover:text-coral transition-all" />
                            </div>
                        </Link>
                    ))}
                </div>
            </section>
        </Reveal>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

function ClosingCTA() {
    return (
        <section className="relative overflow-hidden grain border-t border-cream/10 mt-16">
            <div className="absolute inset-0 -z-0 landing-mesh" aria-hidden>
                <span className="mesh-coral" />
                <span className="mesh-indigo" />
            </div>
            <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-28 sm:py-40 text-center">
                <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-cream-dim">
                    your turn
                </p>
                <h2 className="mt-6 font-display text-[clamp(48px,9vw,140px)] leading-[0.95] tracking-tight text-cream">
                    Send an intent.
                    <br />
                    <em className="italic text-coral">Not a key.</em>
                </h2>
                <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
                    <MagneticLink href="/agents" primary>
                        Run your first agent <ArrowRight className="size-4" />
                    </MagneticLink>
                    <MagneticLink href="/developers">
                        Drop in the SDK
                    </MagneticLink>
                </div>
                <p className="mt-10 font-mono text-[11px] tracking-[0.18em] uppercase text-cream-dim">
                    npm install <span className="text-coral">@soloraaa/sdk</span>
                </p>
            </div>
        </section>
    );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function MagneticLink({
    href,
    primary,
    children,
}: {
    href: string;
    primary?: boolean;
    children: React.ReactNode;
}) {
    const ref = useRef<HTMLAnchorElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onMove = (e: MouseEvent) => {
            const r = el.getBoundingClientRect();
            const dx = e.clientX - (r.left + r.width / 2);
            const dy = e.clientY - (r.top + r.height / 2);
            const dist = Math.hypot(dx, dy);
            if (dist > 120) {
                el.style.transform = "translate(0, 0)";
                return;
            }
            el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.18}px)`;
        };
        const onLeave = () => {
            el.style.transform = "translate(0, 0)";
        };
        window.addEventListener("mousemove", onMove);
        el.addEventListener("mouseleave", onLeave);
        return () => {
            window.removeEventListener("mousemove", onMove);
            el.removeEventListener("mouseleave", onLeave);
        };
    }, []);
    return (
        <Link
            ref={ref}
            href={{ pathname: href }}
            data-cursor="link"
            className={
                "magnet inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px] font-medium transition-colors " +
                (primary
                    ? "bg-coral text-ink hover:bg-coral/90 shadow-[0_8px_30px_-8px_hsl(var(--coral)/0.6)]"
                    : "border border-cream/25 text-cream hover:bg-cream/5")
            }
            style={{
                background: primary ? "hsl(var(--coral))" : undefined,
                color: primary ? "hsl(var(--ink))" : undefined,
            }}
        >
            {children}
        </Link>
    );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
    return (
        <div>
            <p className="font-mono text-[11px] tracking-[0.22em] text-coral">{n}</p>
            <h3 className="mt-3 font-display text-[26px] leading-tight text-cream">
                {title}
            </h3>
            <p className="mt-2 text-[14px] leading-[1.6] text-cream-soft">{body}</p>
        </div>
    );
}

function KeyRow({
    idx,
    name,
    place,
    does,
    compromise,
}: {
    idx: string;
    name: string;
    place: string;
    does: string;
    compromise: string;
}) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-[80px_1fr_1.5fr_1.5fr] gap-3 md:gap-6 py-6 items-start">
            <p className="font-mono text-[11px] tracking-[0.22em] text-coral">{idx}</p>
            <h3 className="font-display text-[22px] leading-tight text-cream">
                {name}
            </h3>
            <p className="text-[14px] leading-[1.6] text-cream-soft">
                <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-cream-dim block mb-1">
                    where
                </span>
                {place}
                <br />
                <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-cream-dim block mt-3 mb-1">
                    what it does
                </span>
                {does}
            </p>
            <p className="text-[14px] leading-[1.6] text-cream-soft">
                <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-cream-dim block mb-1">
                    if compromised
                </span>
                {compromise}
            </p>
        </div>
    );
}

/**
 * Wrap a section to add a blur-and-rise reveal as it enters the viewport.
 * Pure intersection observer — no scroll listeners, no layout thrash.
 */
function Reveal({ children }: { children: React.ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (e.isIntersecting) {
                        el.classList.add("reveal-in");
                        io.unobserve(el);
                    }
                }
            },
            { threshold: 0.18 }
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);
    return (
        <div ref={ref} className="reveal-init">
            {children}
        </div>
    );
}
