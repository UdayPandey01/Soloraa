"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { WalletButton } from "@/components/wallet-button";

const NAV_LINKS = [
    { href: "/agents", label: "Agents" },
    { href: "/portfolio", label: "Portfolio" },
    { href: "/security", label: "Security" },
    { href: "/developers", label: "Developers" },
    { href: "/docs", label: "Docs" },
] as const;

const SHRINK_SCROLL_PX = 80;

export function Nav() {
    const pathname = usePathname();
    const isLanding = pathname === "/";
    const [mobileOpen, setMobileOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!mobileOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [mobileOpen]);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > SHRINK_SCROLL_PX);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const surfaceClass = isLanding
        ? scrolled
            ? "bg-black/45 border-white/12"
            : "bg-transparent border-transparent"
        : scrolled
          ? "bg-bg/72 border-line"
          : "bg-bg/35 border-line/40";

    const textInactive = isLanding && !scrolled
        ? "text-white/75 hover:text-white"
        : "text-fg-muted hover:text-fg";
    const textActive = isLanding && !scrolled ? "text-white" : "text-fg";

    return (
        <header className="sticky top-0 z-50 pointer-events-none">
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{
                    opacity: 1,
                    y: 0,
                    maxWidth: scrolled ? 820 : 1280,
                    borderRadius: scrolled ? 9999 : 16,
                    marginTop: scrolled ? 14 : 0,
                    paddingLeft: scrolled ? 14 : 20,
                    paddingRight: scrolled ? 8 : 16,
                    boxShadow: scrolled
                        ? "0 20px 60px -28px rgba(0,0,0,0.6), 0 4px 14px -10px rgba(0,0,0,0.4)"
                        : "0 0 0 transparent",
                }}
                transition={{
                    opacity: { duration: 0.5, ease: [0.21, 1.02, 0.73, 1] },
                    y: { duration: 0.5, ease: [0.21, 1.02, 0.73, 1] },
                    maxWidth: { type: "spring", stiffness: 180, damping: 26 },
                    borderRadius: { type: "spring", stiffness: 180, damping: 26 },
                    marginTop: { type: "spring", stiffness: 180, damping: 26 },
                    paddingLeft: { type: "spring", stiffness: 180, damping: 26 },
                    paddingRight: { type: "spring", stiffness: 180, damping: 26 },
                    boxShadow: { duration: 0.35 },
                }}
                className={cn(
                    "pointer-events-auto mx-auto w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] flex items-center justify-between gap-3 py-2.5 border backdrop-blur-xl transition-colors duration-300",
                    surfaceClass
                )}
            >
                <Link href="/" className="flex items-center gap-2.5 group shrink-0">
                    <Logo invert={isLanding && !scrolled} />
                    <span
                        className={cn(
                            "text-[15px] tracking-tight",
                            isLanding && !scrolled ? "text-white" : "text-fg"
                        )}
                    >
                        Solor
                        <em
                            className="italic"
                            style={{ fontFamily: "var(--font-display)" }}
                        >
                            a
                        </em>
                    </span>
                    <motion.span
                        animate={{ opacity: scrolled ? 0 : 1, width: scrolled ? 0 : "auto" }}
                        transition={{ duration: 0.2 }}
                        className={cn(
                            "hidden sm:inline-flex overflow-hidden whitespace-nowrap text-[10px] font-mono uppercase tracking-widest ml-1",
                            isLanding && !scrolled ? "text-white/40" : "text-fg-dim"
                        )}
                    >
                        sdk v0.2
                    </motion.span>
                </Link>

                <nav className="hidden md:flex items-center gap-0.5">
                    {NAV_LINKS.map((link) => {
                        const active =
                            pathname === link.href || pathname.startsWith(`${link.href}/`);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "relative rounded-full px-3 py-1.5 text-sm transition-colors",
                                    active ? textActive : textInactive
                                )}
                            >
                                {active && (
                                    <motion.span
                                        layoutId="nav-pill"
                                        className={cn(
                                            "absolute inset-0 rounded-full -z-10",
                                            isLanding && !scrolled
                                                ? "bg-white/15"
                                                : "bg-fg/10"
                                        )}
                                        transition={{
                                            type: "spring",
                                            stiffness: 340,
                                            damping: 28,
                                        }}
                                    />
                                )}
                                {link.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-2 shrink-0">
                    <div className={cn(scrolled ? "scale-95" : "scale-100", "transition-transform duration-200")}>
                        <WalletButton />
                    </div>
                    <button
                        type="button"
                        onClick={() => setMobileOpen((v) => !v)}
                        className={cn(
                            "md:hidden grid size-9 place-items-center rounded-full border transition-colors",
                            isLanding && !scrolled
                                ? "border-white/25 text-white/90"
                                : "border-line-bright bg-bg-surface text-fg-soft hover:text-fg"
                        )}
                        aria-label={mobileOpen ? "Close menu" : "Open menu"}
                    >
                        {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
                    </button>
                </div>
            </motion.div>

            <AnimatePresence>
                {mobileOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="pointer-events-auto mx-auto mt-2 w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] md:hidden rounded-2xl border border-line bg-bg/95 backdrop-blur-xl shadow-[0_20px_60px_-28px_rgba(0,0,0,0.6)]"
                    >
                        <nav className="px-3 py-2 grid gap-0.5">
                            {NAV_LINKS.map((link) => {
                                const active =
                                    pathname === link.href ||
                                    pathname.startsWith(`${link.href}/`);
                                return (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        className={cn(
                                            "rounded-xl px-3 py-2.5 text-[14px]",
                                            active
                                                ? "bg-bg-raised text-fg"
                                                : "text-fg-soft hover:bg-bg-surface hover:text-fg"
                                        )}
                                    >
                                        {link.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </motion.div>
                )}
            </AnimatePresence>
        </header>
    );
}

function Logo({ invert = false }: { invert?: boolean }) {
    const stroke = invert ? "white" : "hsl(var(--fg))";
    const fill = invert ? "white" : "hsl(var(--fg))";
    return (
        <span className="relative inline-flex">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    d="M12 2 L20 7 V17 L12 22 L4 17 V7 Z"
                    stroke={stroke}
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                />
                <path
                    d="M12 7 L16 9.5 V14.5 L12 17 L8 14.5 V9.5 Z"
                    fill={fill}
                    fillOpacity="0.18"
                />
            </svg>
        </span>
    );
}
