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

export function Nav() {
    const pathname = usePathname();
    const [mobileOpen, setMobileOpen] = useState(false);

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

    return (
        <motion.header
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.21, 1.02, 0.73, 1] }}
            className="sticky top-0 z-50 border-b border-line/50 bg-bg/80 backdrop-blur-xl"
        >
            <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
                <Link href="/" className="flex items-center gap-2.5 group">
                    <Logo />
                    <span className="text-sm font-medium tracking-tight">Soloraa</span>
                    <span className="hidden sm:inline-flex text-[10px] font-mono uppercase tracking-widest text-fg-dim ml-1">
                        v0.1
                    </span>
                </Link>

                <nav className="hidden md:flex items-center gap-1">
                    {NAV_LINKS.map((link) => {
                        const active =
                            pathname === link.href || pathname.startsWith(`${link.href}/`);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    "relative px-3 py-1.5 text-sm transition-colors",
                                    active ? "text-fg" : "text-fg-muted hover:text-fg"
                                )}
                            >
                                {link.label}
                                {active && (
                                    <motion.span
                                        layoutId="nav-underline"
                                        className="absolute inset-x-3 -bottom-[13px] h-px bg-fg"
                                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                    />
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-2">
                    <WalletButton />
                    <button
                        type="button"
                        onClick={() => setMobileOpen((v) => !v)}
                        className="md:hidden grid size-9 place-items-center rounded-full border border-line-bright bg-bg-surface text-fg-soft hover:text-fg"
                        aria-label={mobileOpen ? "Close menu" : "Open menu"}
                    >
                        {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {mobileOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.1, ease: "easeOut" }}
                        className="md:hidden border-t border-line/60 bg-bg/95 backdrop-blur-xl"
                    >
                        <nav className="mx-auto max-w-7xl px-4 py-3 grid gap-1">
                            {NAV_LINKS.map((link) => {
                                const active =
                                    pathname === link.href ||
                                    pathname.startsWith(`${link.href}/`);
                                return (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        className={cn(
                                            "rounded-lg px-3 py-2.5 text-[14px]",
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
        </motion.header>
    );
}

function Logo() {
    return (
        <span className="relative inline-flex">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    d="M12 2 L20 7 V17 L12 22 L4 17 V7 Z"
                    stroke="hsl(var(--fg))"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                />
                <path
                    d="M12 7 L16 9.5 V14.5 L12 17 L8 14.5 V9.5 Z"
                    fill="hsl(var(--fg))"
                    fillOpacity="0.18"
                />
            </svg>
        </span>
    );
}
