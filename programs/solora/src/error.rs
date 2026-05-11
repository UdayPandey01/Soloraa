use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The wallet is currently paused by the user.")]
    WalletPaused,
    #[msg("Transaction signed by an unauthorized enclave.")]
    UnauthorizedEnclave,
    #[msg("Only the wallet authority can perform this action.")]
    UnauthorizedUser,
    #[msg("Self-routing CPI into the Solora program is not allowed.")]
    SelfRoutingDetected,
    #[msg("No active timelock is set.")]
    NoTimelock,
    #[msg("Escape timelock is still active.")]
    TimelockActive,
    #[msg("Instructions sysvar account is not the canonical sysvar.")]
    InvalidIxSysvar,
    #[msg("Expected the Ed25519Program verification instruction at index 0.")]
    MissingEdwardsIx,
    #[msg("Index 0 is not the Ed25519Program.")]
    WrongIxAtIndex0,
    #[msg("Execute instruction must be immediately preceded by an Ed25519 verify ix.")]
    WrongExecuteIxIndex,
    #[msg("Ed25519Program instruction is malformed.")]
    EdwardsIxMalformed,
    #[msg("Ed25519Program instruction has unsupported signature count.")]
    EdwardsIxCountUnsupported,
    #[msg("Ed25519Program instruction references off-instruction data; only inline data is supported.")]
    EdwardsIxOffChainData,
    #[msg("Ed25519 signature pubkey does not match wallet.enclave_signer.")]
    EnclaveSignerMismatch,
    #[msg("Signed intent message has the wrong length.")]
    IntentMsgWrongSize,
    #[msg("Signed intent message has the wrong domain prefix.")]
    IntentDomainMismatch,
    #[msg("Signed intent message is bound to a different program id.")]
    IntentProgramMismatch,
    #[msg("Signed intent message is bound to a different wallet PDA.")]
    IntentWalletMismatch,
    #[msg("Signed intent nonce does not match the on-chain wallet nonce.")]
    IntentNonceMismatch,
    #[msg("Signed intent has expired (current slot is past expiry).")]
    IntentExpired,
    #[msg("Signed intent kind does not match the executing instruction.")]
    IntentKindMismatch,
    #[msg("Signed intent payload hash does not match the executing instruction's arguments.")]
    IntentPayloadMismatch,
    #[msg("Wallet nonce overflow.")]
    NonceOverflow,
    #[msg("Insufficient wallet balance after transfer would break rent exemption.")]
    InsufficientWalletBalance,
    #[msg("Target program is not in the wallet's CPI allowlist.")]
    TargetProgramNotAllowed,
    #[msg("Allowlist is at capacity; remove a program before adding another.")]
    AllowlistFull,
    #[msg("Program is already in the allowlist.")]
    DuplicateAllowedProgram,
    #[msg("Program is not currently in the allowlist.")]
    AllowedProgramNotFound,
    #[msg("CPI exceeds the remaining_accounts cap.")]
    TooManyCpiAccounts,
    #[msg("CPI instruction data exceeds size limit.")]
    CpiInstructionDataTooLarge,
    #[msg("SlotHashes sysvar account is not the canonical sysvar.")]
    InvalidSlotHashesSysvar,
    #[msg("SlotHashes sysvar data is malformed.")]
    SlotHashesAccountInvalid,
    #[msg("Signed blockhash slot is outside the SlotHashes retention window.")]
    BlockhashSlotNotFound,
    #[msg("Signed blockhash does not match the on-chain SlotHashes entry for that slot.")]
    BlockhashMismatch,
    #[msg("Measurement registry is at capacity; revoke before adding another.")]
    MeasurementRegistryFull,
    #[msg("Measurement is already in the registry.")]
    DuplicateMeasurement,
    #[msg("Measurement not found in the registry.")]
    MeasurementNotFound,
    #[msg("Measurement is revoked and cannot be used for attestation.")]
    MeasurementRevoked,
    #[msg("Caller is not the registry governor.")]
    UnauthorizedGovernor,
    #[msg("Attestation message has the wrong length.")]
    AttestationMsgWrongSize,
    #[msg("Attestation message has the wrong domain prefix.")]
    AttestationDomainMismatch,
    #[msg("Attestation message is bound to a different program id.")]
    AttestationProgramMismatch,
    #[msg("Attestation message is bound to a different wallet PDA.")]
    AttestationWalletMismatch,
    #[msg("Attestation message is bound to a different wallet nonce.")]
    AttestationNonceMismatch,
    #[msg("Attestation has expired (current slot is past expiry).")]
    AttestationExpired,
    #[msg("Attestation message references a measurement not present in the registry.")]
    AttestationMeasurementMismatch,
    #[msg("Attestation governor signature does not match registry.governor.")]
    AttestationGovernorMismatch,
}
