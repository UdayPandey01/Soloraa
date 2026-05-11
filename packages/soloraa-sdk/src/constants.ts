/**
 * Protocol constants the SDK and on-chain program agree on byte-for-byte.
 * If you change one of these, you change the on-chain verifier too.
 */

export const INTENT_DOMAIN = "SOLORA_INTENT_V2";
export const SOLORA_INTENT_V2_BYTES = 169;

/** Offsets of every field within the 169-byte canonical message. */
export const INTENT_OFFSETS = {
    domain: 0,
    programId: 16,
    walletPda: 48,
    nonce: 80,
    expirySlot: 88,
    recentBlockhash: 96,
    blockhashSlot: 128,
    kind: 136,
    payloadHash: 137,
} as const;

/** Intent kind tags written at offset 136. */
export const INTENT_KIND = {
    transfer: 0,
    swap: 1,
    lend: 2,
    cpi: 3,
} as const;

/** Mirrors `programs/solora/src/error.rs`. */
export const ERROR_NAMES: Record<number, string> = {
    6000: "WalletPaused",
    6017: "EnclaveSignerMismatch",
    6018: "IntentNonceMismatch",
    6019: "IntentExpired",
    6020: "IntentKindMismatch",
    6021: "IntentPayloadMismatch",
    6027: "TargetProgramNotAllowed",
    6033: "BlockhashMismatch",
    6037: "MeasurementRevoked",
    6045: "AttestationMeasurementMismatch",
    6046: "AttestationGovernorMismatch",
};
