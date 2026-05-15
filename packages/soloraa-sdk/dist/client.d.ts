import { PublicKey } from "@solana/web3.js";
import type { ExecutionIntent, ExecutionResult, ExecutionStreamEvent, SoloraaClientConfig, StreamOpts, VerifyIntentInput, VerifyResult } from "./types.js";
/**
 * Soloraa client. Holds the three endpoints it needs and the wallet PDA it
 * acts on behalf of. The client never holds a private key — every signature
 * comes from the attested enclave service.
 */
export declare class SoloraaClient {
    private readonly conn;
    private readonly enclaveUrl;
    private readonly walletPda;
    private readonly cuLimit;
    private readonly expirySlotsAhead;
    private readonly relayer?;
    constructor(config: SoloraaClientConfig);
    /**
     * Submit an intent, get the confirmed transaction back. Blocks until
     * Solana reaches `confirmed` commitment on the result.
     */
    execute(intent: ExecutionIntent): Promise<ExecutionResult>;
    /**
     * Re-derive the canonical message from raw bytes and run light validation.
     * Useful for tooling that observes intents without broadcasting. Note: a
     * full re-verification matches the on-chain rules; this function checks
     * structure, the domain prefix, message length, and the signature against
     * the supplied pubkey.
     */
    verifyIntent(input: VerifyIntentInput): Promise<VerifyResult>;
    /**
     * Subscribe to the seven-stage execution lifecycle for an in-flight run.
     * Backed by Server-Sent Events from /api/agent/run on the host.
     */
    stream(opts: StreamOpts): AsyncIterable<ExecutionStreamEvent>;
    private buildEnclaveRequest;
    private dispatchToEnclave;
    private buildWrappingTx;
    /**
     * Real Ed25519 verification of (message, signature, pubkey) using the
     * pure-JS @noble/ed25519 implementation. Runs entirely client-side;
     * never trusts the enclave's word on its own signature.
     *
     * Returns true iff the signature was produced by `pubkey` over `message`.
     * Returns false on any malformed input rather than throwing — the caller
     * decides how to surface the rejection.
     */
    private verifyEd25519;
    private extractErrorCode;
    readonly sysvarInstructions: PublicKey;
}
export declare class SoloraaExecutionError extends Error {
    readonly code: number | undefined;
    readonly name_: string | undefined;
    readonly docUrl?: string | undefined;
    constructor(code: number | undefined, name_: string | undefined, message: string, docUrl?: string | undefined);
}
//# sourceMappingURL=client.d.ts.map