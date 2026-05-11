/**
 * Public type surface of @soloraa/sdk.
 *
 * Every type lives in this file so library consumers and tools (Zod schemas,
 * docs generators, OpenAPI translations) have a single source of truth.
 */

import type { PublicKey, Keypair } from "@solana/web3.js";

// ── Client configuration ─────────────────────────────────────────────────────

export interface SoloraaClientConfig {
    /** Solana RPC endpoint. The client uses confirmed commitment by default. */
    rpcUrl: string;
    /** Base URL of the enclave HTTP service (e.g. http://127.0.0.1:8080). */
    enclaveUrl: string;
    /** Wallet PDA the client acts on behalf of (base58). */
    walletPda: string | PublicKey;
    /** Optional relayer keypair used to sign and pay for the wrapping tx. */
    relayerKeypair?: Keypair;
    /**
     * Number of slots ahead of `getSlot('confirmed')` the signed intent's
     * expiry is set to. Default 60 (~25s on devnet). Minimum 5.
     */
    expirySlotsAhead?: number;
    /** Compute unit limit prepended to the tx. Default 200_000. */
    cuLimit?: number;
}

// ── Intent inputs ────────────────────────────────────────────────────────────

export type ExecutionIntent =
    | TransferIntent
    | SwapIntent
    | LendIntent
    | ArbitraryCpiIntent;

export interface TransferIntent {
    action: "transfer";
    destination: string | PublicKey;
    /** Amount in lamports. */
    amount: bigint;
}

export interface SwapIntent {
    action: "swap";
    protocol: "jupiter";
    inputMint: string | PublicKey;
    outputMint: string | PublicKey;
    /** Amount in inputMint's smallest unit. */
    amount: bigint;
    constraints?: {
        /** Hard cap; the enclave will not sign over the wallet's policy. */
        maxSlippageBps?: number;
    };
}

export interface LendIntent {
    action: "lend";
    protocol: "kamino" | "marginfi" | "solend";
    mint: string | PublicKey;
    amount: bigint;
}

export interface ArbitraryCpiIntent {
    action: "cpi";
    targetProgram: string | PublicKey;
    instructionData: Uint8Array;
    accountMetas: Array<{
        pubkey: string | PublicKey;
        isSigner: boolean;
        isWritable: boolean;
    }>;
}

// ── Execution result ─────────────────────────────────────────────────────────

export interface ExecutionResult {
    /** Confirmed Solana tx signature. */
    signature: string;
    /** Wallet nonce after the on-chain bump. */
    walletNonce: number;
    /** Bytes signed by the enclave (always 169 bytes, SOLORA_INTENT_V2). */
    bytesSigned: Uint8Array;
    /** Slot the tx confirmed in. */
    confirmedSlot: number;
}

// ── Verification surface ─────────────────────────────────────────────────────

export interface VerifyIntentInput {
    /** 169-byte canonical message. */
    message: Uint8Array;
    /** 64-byte Ed25519 signature. */
    signature: Uint8Array;
    /** Base58 enclave pubkey that should appear as wallet.enclave_signer. */
    enclavePubkey: string;
}

export type VerifyResult =
    | { ok: true; fields: IntentFields }
    | { ok: false; reason: IntentRejectReason };

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

export type IntentRejectReason =
    | "wrong_length"
    | "wrong_domain"
    | "bad_signature"
    | "stale_blockhash"
    | "nonce_mismatch";

// ── Streaming events ─────────────────────────────────────────────────────────

export type ExecutionStreamEvent =
    | { stage: "intent"; ts: number; title: string }
    | { stage: "policy"; ts: number; title: string }
    | {
          stage: "oracle";
          ts: number;
          feedId?: string;
          quorum?: { valid: number; total: number };
      }
    | { stage: "build"; ts: number; bytes: number }
    | { stage: "sign"; ts: number; pubkey: string }
    | { stage: "broadcast"; ts: number; txSignature: string }
    | {
          stage: "verify";
          ts: number;
          ok: boolean;
          error?: { code: number; name: string; description: string };
          txSignature?: string;
      };

export interface StreamOpts {
    /** Server-issued run identifier, returned from a prior client.execute(). */
    runId: string;
}
