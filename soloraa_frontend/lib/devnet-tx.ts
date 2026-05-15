"use client";

import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export const MEMO_PROGRAM_ID = new PublicKey(
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

export type Cluster = "devnet" | "mainnet-beta" | "localnet";

function explorerUrl(signature: string, cluster: Cluster): string {
    return `https://explorer.solana.com/tx/${signature}${
        cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`
    }`;
}

export async function sendMemo(
    connection: Connection,
    wallet: WalletContextState,
    memo: string,
    cluster: Cluster = "devnet"
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

    return { signature, explorerUrl: explorerUrl(signature, cluster) };
}

export async function delegateToBurner(
    connection: Connection,
    wallet: WalletContextState,
    burnerPubkey: PublicKey,
    solAmount: number,
    cluster: Cluster = "devnet"
): Promise<{ signature: string; explorerUrl: string }> {
    if (!wallet.publicKey || !wallet.sendTransaction) {
        throw new Error("Wallet not connected");
    }

    const ix = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: burnerPubkey,
        lamports: Math.floor(solAmount * LAMPORTS_PER_SOL),
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

    return { signature, explorerUrl: explorerUrl(signature, cluster) };
}

export async function sendMemoWithSigner(
    connection: Connection,
    signer: Keypair,
    memo: string,
    cluster: Cluster = "devnet"
): Promise<{ signature: string; explorerUrl: string }> {
    const ix = new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memo, "utf8"),
    });

    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction().add(ix);
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(signer);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
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

    return { signature, explorerUrl: explorerUrl(signature, cluster) };
}

export async function withdrawFromBurner(
    connection: Connection,
    signer: Keypair,
    destination: PublicKey,
    cluster: Cluster = "devnet"
): Promise<{ signature: string; explorerUrl: string; lamportsReturned: number }> {
    const balance = await connection.getBalance(signer.publicKey, "confirmed");
    const reserveForFee = 5_000;
    if (balance <= reserveForFee) {
        throw new Error(
            `Session key has ${balance} lamports — not enough to cover the withdrawal fee.`
        );
    }
    const lamportsToReturn = balance - reserveForFee;

    const ix = SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: destination,
        lamports: lamportsToReturn,
    });

    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction().add(ix);
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(signer);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
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

    return {
        signature,
        explorerUrl: explorerUrl(signature, cluster),
        lamportsReturned: lamportsToReturn,
    };
}

export function shortSig(sig: string, head = 6, tail = 6): string {
    if (sig.length <= head + tail + 3) return sig;
    return `${sig.slice(0, head)}…${sig.slice(-tail)}`;
}

export function shortPubkey(pk: string, head = 4, tail = 4): string {
    if (pk.length <= head + tail + 3) return pk;
    return `${pk.slice(0, head)}…${pk.slice(-tail)}`;
}
