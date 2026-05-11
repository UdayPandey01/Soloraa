"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import {
    ConnectionProvider,
    WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
    PhantomWalletAdapter,
    SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import type { WalletError } from "@solana/wallet-adapter-base";
import { RPC_URL } from "@/lib/solora";

import "@solana/wallet-adapter-react-ui/styles.css";

interface Props {
    children: ReactNode;
}

export function SolanaWalletProvider({ children }: Props) {
    const endpoint = useMemo(() => RPC_URL, []);

    const wallets = useMemo(
        () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
        []
    );

    const onError = useCallback((error: WalletError) => {
        if (typeof console !== "undefined") {
            console.warn("[solora wallet]", error.name, error.message);
        }
    }, []);

    return (
        <ConnectionProvider
            endpoint={endpoint}
            config={{ commitment: "confirmed" }}
        >
            <WalletProvider
                wallets={wallets}
                onError={onError}
                autoConnect
                localStorageKey="soloraa:wallet"
            >
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
