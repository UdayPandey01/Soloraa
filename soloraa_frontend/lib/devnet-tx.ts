"use client";

import {
    Connection,
    PublicKey,
    Transaction,
    TransactionInstruction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export const MEMO_PROGRAM_ID = new PublicKey(
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

/**
 * Builds a single-ix memo transaction and sends it via the connected wallet.
 * Returns the confirmed signature + explorer URL for the active cluster.
 *
 * Memos are zero-cost, account-free, and visible on every Solana explorer.
 * The frontend uses them to demonstrate real devnet activity without
 * requiring any deployed user-facing program.
 */
export async function sendMemo(
    connection: Connection,
    wallet: WalletContextState,
    memo: string,
    cluster: "devnet" | "mainnet-beta" | "localnet" = "devnet"
): Promise<{ signature: string; explorerUrl: string }> {
    if (!wallet.publicKey || !wallet.sendTransaction) {
        throw new Error("Wallet not connected");
    }

    const ix = new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memo, "utf8"),
    });

    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction().add(ix);
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = latest.blockhash;

    const signature = await wallet.sendTransaction(tx, connection, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
    });

    await connection.confirmTransaction(
        {
            signature,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed"
    );

    const explorerUrl = `https://explorer.solana.com/tx/${signature}${
        cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`
    }`;

    return { signature, explorerUrl };
}

export function shortSig(sig: string, head = 6, tail = 6): string {
    if (sig.length <= head + tail + 3) return sig;
    return `${sig.slice(0, head)}…${sig.slice(-tail)}`;
}
