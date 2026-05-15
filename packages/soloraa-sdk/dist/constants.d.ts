/**
 * Protocol constants the SDK and on-chain program agree on byte-for-byte.
 * If you change one of these, you change the on-chain verifier too.
 */
export declare const INTENT_DOMAIN = "SOLORA_INTENT_V2";
export declare const SOLORA_INTENT_V2_BYTES = 169;
/** Offsets of every field within the 169-byte canonical message. */
export declare const INTENT_OFFSETS: {
    readonly domain: 0;
    readonly programId: 16;
    readonly walletPda: 48;
    readonly nonce: 80;
    readonly expirySlot: 88;
    readonly recentBlockhash: 96;
    readonly blockhashSlot: 128;
    readonly kind: 136;
    readonly payloadHash: 137;
};
/** Intent kind tags written at offset 136. */
export declare const INTENT_KIND: {
    readonly transfer: 0;
    readonly swap: 1;
    readonly lend: 2;
    readonly cpi: 3;
};
/** Mirrors `programs/solora/src/error.rs`. */
export declare const ERROR_NAMES: Record<number, string>;
export declare const ERROR_DOCS: Record<number, string>;
//# sourceMappingURL=constants.d.ts.map