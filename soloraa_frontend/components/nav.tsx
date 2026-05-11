"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
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

    return (
        <motion.header
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.21, 1.02, 0.73, 1] }}
            className="sticky top-0 z-50 border-b border-line/50 bg-bg/80 backdrop-blur-xl"
        >
            <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2.5 group">
                    <Logo />
                    <span className="text-sm font-medium tracking-tight">Soloraa</span>
                    <span className="hidden sm:inline-flex text-[10px] font-mono uppercase tracking-widest text-fg-dim ml-1">
                        v0.1
                    </span>
                </Link>

                <nav className="hidden md:flex items-center gap-1">
                    {NAV_LINKS.map((link) => {
                        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
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
                </div>
            </div>
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
