/**
 * Single source of truth for protocol constants the frontend renders.
 * Mirrors `programs/solora/src/state.rs` byte-for-byte. If the on-chain
 * program changes, update this file and search for the constants.
 */

export const PROGRAM_ID =
    process.env.NEXT_PUBLIC_SOLORA_PROGRAM_ID ??
    "8tkBctMGe5CsGQ731t9di9hBjGg7rbMo4VEk8WujvTPS";

export const CLUSTER =
    (process.env.NEXT_PUBLIC_SOLANA_CLUSTER as
        | "localnet"
        | "devnet"
        | "mainnet-beta") ?? "devnet";

export const RPC_URL =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/** Domain prefix on every signed intent — guarantees cross-version replay safety. */
export const INTENT_DOMAIN = "SOLORA_INTENT_V2";
export const INTENT_MSG_LEN = 169;

/** Domain prefix on every governor-signed enclave-rotation proof. */
export const ATTEST_DOMAIN = "SOLORA_ATTEST_V1";
export const ATTEST_MSG_LEN = 168;

/**
 * Byte layout of the canonical signed intent. Kept in declared order so the
 * landing-page byte visualization can render it as a contiguous strip with
 * accurate offsets.
 */
export const INTENT_FIELDS = [
    { offset: 0, length: 16, name: "domain", label: "SOLORA_INTENT_V2" },
    { offset: 16, length: 32, name: "program_id", label: "Program ID" },
    { offset: 48, length: 32, name: "wallet_pda", label: "Wallet PDA" },
    { offset: 80, length: 8, name: "nonce", label: "Nonce" },
    { offset: 88, length: 8, name: "expiry_slot", label: "Expiry slot" },
    { offset: 96, length: 32, name: "recent_blockhash", label: "Recent blockhash" },
    { offset: 128, length: 8, name: "blockhash_slot", label: "Blockhash slot" },
    { offset: 136, length: 1, name: "kind", label: "Kind" },
    { offset: 137, length: 32, name: "payload_hash", label: "Payload hash" },
] as const;

/**
 * The seven stages of an autonomous-execution pipeline. The order MUST match
 * what the live agent run experience streams. Stage IDs are stable so SSE
 * events from the live mode can target them.
 */
export const PIPELINE_STAGES = [
    {
        id: "intent",
        title: "Intent received",
        detail: "AI agent submits a structured trade intent.",
    },
    {
        id: "policy",
        title: "Policy evaluated",
        detail: "Wallet pause, trade-size cap, slippage cap, allowlist.",
    },
    {
        id: "oracle",
        title: "Oracle verified",
        detail: "Pyth update fetched. Wormhole guardian quorum + merkle proof.",
    },
    {
        id: "build",
        title: "Canonical message built",
        detail: "169-byte SOLORA_INTENT_V2: program_id, nonce, blockhash, payload hash.",
    },
    {
        id: "sign",
        title: "Enclave signs",
        detail: "Sealed Ed25519 key inside the TEE produces a 64-byte signature.",
    },
    {
        id: "broadcast",
        title: "Broadcast to Solana",
        detail: "Ed25519 verify ix at index 0, execute at index 1.",
    },
    {
        id: "verify",
        title: "On-chain verification",
        detail: "Program re-checks every field. Bumps wallet.nonce on success.",
    },
] as const;

/** Errors the on-chain verifier can throw. Mirrors `error.rs`. */
export const ERROR_CATALOG: Record<number, { name: string; description: string }> = {
    6000: { name: "WalletPaused", description: "Wallet authority has paused all execution." },
    6018: {
        name: "IntentNonceMismatch",
        description: "Signed intent nonce does not match the on-chain wallet nonce. Replay rejected.",
    },
    6019: { name: "IntentExpired", description: "Signed intent expired. Past the bound slot." },
    6020: { name: "IntentKindMismatch", description: "Signed kind doesn't match executing instruction." },
    6021: { name: "IntentPayloadMismatch", description: "Payload hash mismatch — destination, amount, or accounts altered." },
    6033: {
        name: "BlockhashMismatch",
        description: "Signed blockhash doesn't match the on-chain SlotHashes entry. Cross-fork replay rejected.",
    },
    6037: { name: "MeasurementRevoked", description: "Enclave measurement has been revoked by governance." },
    6045: {
        name: "AttestationMeasurementMismatch",
        description: "Attestation references a measurement not in the registry.",
    },
    6046: { name: "AttestationGovernorMismatch", description: "Attestation signed by a non-governor key." },
};
