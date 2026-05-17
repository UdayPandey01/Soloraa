import type { PublicKey } from "@solana/web3.js";
export interface SoloraaClientConfig {
    /**
     * Relayer URL. Defaults to the hosted public relayer at
     * https://relayer.soloraa.tech (single-tenant demo wallet). For real
     * production use, deploy your own relayer and point the SDK at it.
     */
    relayerUrl?: string;
    /**
     * Optional. When set, every execute call routes through the wallet PDA
     * derived from this authority pubkey. When unset, the relayer falls back
     * to its own default authority (hosted relayer demo behaviour).
     */
    walletAuthority?: string | PublicKey;
    /**
     * Optional. Tag stamped onto every request for the relayer's logs. Useful
     * for distinguishing one consumer of the same relayer from another.
     */
    agentId?: string;
    /**
     * Optional. fetch implementation override. Defaults to the global fetch.
     */
    fetchImpl?: typeof fetch;
}
export interface TransferRequest {
    /** Recipient pubkey (base58 or PublicKey instance). */
    destination: string | PublicKey;
    /** Amount in lamports. Minimum ~890,880 to keep the destination rent-exempt. */
    amountLamports: bigint | number;
    /** Optional cycle counter — surfaced in relayer logs. */
    cycle?: number;
}
export interface ExecutionResult {
    /** Confirmed Solana tx signature. */
    signature: string;
    /** Explorer URL pre-built for the right cluster. */
    explorerUrl: string;
    /** Wallet nonce as of the start of this execution (pre-bump). */
    nonceBefore: string;
    /** Cycle counter echoed back from the request, if any. */
    cycle?: number;
}
export interface VerifyIntentInput {
    /** 169-byte canonical message. */
    message: Uint8Array;
    /** 64-byte Ed25519 signature. */
    signature: Uint8Array;
    /** Base58 enclave pubkey that should appear as wallet.enclave_signer. */
    enclavePubkey: string;
}
export type VerifyResult = {
    ok: true;
    fields: IntentFields;
} | {
    ok: false;
    reason: IntentRejectReason;
};
export interface IntentFields {
    domain: string;
    programId: string;
    walletPda: string;
    nonce: bigint;
    expirySlot: bigint;
    recentBlockhash: string;
    blockhashSlot: bigint;
    kind: number;
    payloadHash: string;
}
export type IntentRejectReason = "wrong_length" | "wrong_domain" | "bad_signature";
export interface RelayerHealth {
    status: string;
    programId: string;
    cluster: string;
}
export interface RelayerKeys {
    authority: string;
    enclavePubkey: string;
}
//# sourceMappingURL=types.d.ts.map