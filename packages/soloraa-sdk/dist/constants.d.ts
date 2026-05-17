export declare const INTENT_DOMAIN = "SOLORA_INTENT_V2";
export declare const SOLORA_INTENT_V2_BYTES = 169;
export declare const DEFAULT_RELAYER_URL = "https://relayer.soloraa.tech";
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
export declare const INTENT_KIND: {
    readonly transfer: 0;
    readonly arbitraryCpi: 1;
};
export declare const ERROR_NAMES: Record<number, string>;
export declare const ERROR_DOCS: Record<number, string>;
//# sourceMappingURL=constants.d.ts.map