"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ChevronDown, CircleDashed, Copy, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function WalletButton() {
    const { publicKey, connected, connecting, disconnecting, disconnect } = useWallet();
    const { setVisible } = useWalletModal();
    const [menuOpen, setMenuOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, []);

    useEffect(() => {
        if (!connected) {
            setMenuOpen(false);
        }
    }, [connected]);

    useEffect(() => {
        if (!copied) return;
        const timeout = setTimeout(() => setCopied(false), 1400);
        return () => clearTimeout(timeout);
    }, [copied]);

    const shortAddress = useMemo(() => {
        if (!publicKey) return null;
        const base58 = publicKey.toBase58();
        return `${base58.slice(0, 4)}…${base58.slice(-4)}`;
    }, [publicKey]);

    const copyAddress = async () => {
        if (!publicKey) return;
        await navigator.clipboard.writeText(publicKey.toBase58());
        setCopied(true);
    };

    const isBusy = connecting || disconnecting;

    return (
        <div ref={menuRef} className="relative">
            <div className="flex items-center gap-1 rounded-full border border-line-bright bg-bg-surface/90 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.15)] backdrop-blur-xl">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={connected ? () => setMenuOpen((value) => !value) : () => setVisible(true)}
                    className="rounded-full border-transparent bg-transparent px-4 text-[12.5px] shadow-none hover:bg-bg-raised"
                >
                    {isBusy ? (
                        <CircleDashed className="size-4 animate-spin" />
                    ) : (
                        <Wallet className="size-4" />
                    )}
                    <span>{connected ? shortAddress ?? "Connected" : "Connect wallet"}</span>
                </Button>

                {connected && (
                    <button
                        type="button"
                        onClick={() => setMenuOpen((value) => !value)}
                        className={cn(
                            "grid size-8 place-items-center rounded-full border border-line-bright text-fg-muted transition-colors hover:border-fg-dim hover:text-fg",
                            menuOpen && "border-fg-dim text-fg"
                        )}
                        aria-label="Open wallet menu"
                    >
                        <ChevronDown className="size-4" />
                    </button>
                )}
            </div>

            {connected && menuOpen && (
                <div className="absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-line-bright bg-bg-surface/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                    <div className="rounded-xl border border-line bg-bg-raised/40 px-4 py-3">
                        <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-fg-dim">
                            Wallet connected
                        </p>
                        <p className="mt-1 text-[13px] text-fg">
                            {shortAddress}
                        </p>
                        <p className="mt-1 text-[11.5px] text-fg-muted">
                            Persistent session, devnet-ready.
                        </p>
                    </div>

                    <div className="mt-2 grid gap-1">
                        <button
                            type="button"
                            onClick={copyAddress}
                            className="flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] text-fg-soft transition-colors hover:bg-bg-raised hover:text-fg"
                        >
                            <span className="inline-flex items-center gap-2">
                                <Copy className="size-4 text-fg-dim" />
                                {copied ? "Copied address" : "Copy address"}
                            </span>
                            <span className="font-mono text-[11px] text-fg-dim">base58</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setVisible(true)}
                            className="flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] text-fg-soft transition-colors hover:bg-bg-raised hover:text-fg"
                        >
                            <span className="inline-flex items-center gap-2">
                                <Wallet className="size-4 text-fg-dim" />
                                Switch wallet
                            </span>
                            <span className="font-mono text-[11px] text-fg-dim">Phantom / Backpack / Solflare</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => void disconnect()}
                            className="flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] text-danger transition-colors hover:bg-danger/10"
                        >
                            <span className="inline-flex items-center gap-2">
                                <LogOut className="size-4" />
                                Disconnect
                            </span>
                            <span className="font-mono text-[11px] text-danger/80">safe</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
