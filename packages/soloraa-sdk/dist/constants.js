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
};
/** Intent kind tags written at offset 136. */
export const INTENT_KIND = {
    transfer: 0,
    swap: 1,
    lend: 2,
    cpi: 3,
};
/** Mirrors `programs/solora/src/error.rs`. */
export const ERROR_NAMES = {
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
/**
 * Doc URLs surfaced on every SoloraaExecutionError. When a transaction is
 * rejected by the on-chain verifier, the SDK includes the right page so
 * an operator can fix it without grepping the codebase.
 */
const DOCS_BASE = "https://docs.soloraa.dev/errors";
export const ERROR_DOCS = {
    6000: `${DOCS_BASE}/wallet-paused`,
    6017: `${DOCS_BASE}/enclave-signer-mismatch`,
    6018: `${DOCS_BASE}/intent-nonce-mismatch`,
    6019: `${DOCS_BASE}/intent-expired`,
    6020: `${DOCS_BASE}/intent-kind-mismatch`,
    6021: `${DOCS_BASE}/intent-payload-mismatch`,
    6027: `${DOCS_BASE}/target-program-not-allowed`,
    6033: `${DOCS_BASE}/blockhash-mismatch`,
    6037: `${DOCS_BASE}/measurement-revoked`,
    6045: `${DOCS_BASE}/attestation-measurement-mismatch`,
    6046: `${DOCS_BASE}/attestation-governor-mismatch`,
};
//# sourceMappingURL=constants.js.map