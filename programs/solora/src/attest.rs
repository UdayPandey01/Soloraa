//! On-chain attestation-proof verification.
//!
//! The off-chain verifier walks the COSE_Sign1 / X.509 / ECDSA-P384 chain back
//! to the AWS Nitro root cert (or Marlin equivalent), extracts PCR0/1/2 and
//! `user_data` (= the new enclave Ed25519 pubkey), then **the registered
//! governor key signs** a canonical 168-byte SOLORA_ATTEST_V1 message binding
//! `(program_id, wallet_pda, enclave_pubkey, measurement_hash, attestation_slot,
//! expiry_slot, wallet_nonce)`.
//!
//! On-chain we re-verify the governor's Ed25519 signature via the instructions
//! sysvar (same pattern as intent verification — see `verify.rs`), match the
//! expected fields, and look up the measurement in the registry.
//!
//! Layout:
//! ```text
//! 0..16    "SOLORA_ATTEST_V1"
//! 16..48   program_id
//! 48..80   wallet_pda
//! 80..112  new_enclave_pubkey
//! 112..144 measurement_hash
//! 144..152 attestation_slot   (u64 LE)
//! 152..160 expiry_slot        (u64 LE)
//! 160..168 wallet_nonce       (u64 LE)
//! ```

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sdk_ids::ed25519_program;
use solana_sdk_ids::sysvar::instructions::ID as IX_SYSVAR_ID;

use crate::error::ErrorCode;
use crate::state::{ATTEST_DOMAIN, ATTEST_MSG_LEN};

pub struct AttestationFields {
    pub new_enclave_pubkey: [u8; 32],
    pub measurement_hash: [u8; 32],
    pub attestation_slot: u64,
    pub expiry_slot: u64,
    pub wallet_nonce: u64,
}

/// Verify an Ed25519-signed governor attestation proof. Returns the parsed
/// fields on success; the caller is responsible for the registry lookup and
/// for applying the resulting state change.
#[allow(clippy::too_many_arguments)]
pub fn verify_attestation_proof(
    ix_sysvar: &AccountInfo,
    program_id: &Pubkey,
    wallet_pda: &Pubkey,
    expected_governor: &Pubkey,
    expected_wallet_nonce: u64,
    current_slot: u64,
) -> Result<AttestationFields> {
    require_keys_eq!(ix_sysvar.key(), IX_SYSVAR_ID, ErrorCode::InvalidIxSysvar);

    let current_index =
        load_current_index_checked(ix_sysvar).map_err(|_| error!(ErrorCode::MissingEdwardsIx))?;
    require!(current_index >= 1, ErrorCode::WrongExecuteIxIndex);

    let ed_ix_index = (current_index - 1) as usize;
    let ed_ix = load_instruction_at_checked(ed_ix_index, ix_sysvar)
        .map_err(|_| error!(ErrorCode::MissingEdwardsIx))?;
    require_keys_eq!(
        ed_ix.program_id,
        ed25519_program::ID,
        ErrorCode::WrongIxAtIndex0
    );

    let (sig_pubkey, msg) = parse_ed25519_ix(&ed_ix.data)?;
    require!(
        sig_pubkey == expected_governor.to_bytes(),
        ErrorCode::AttestationGovernorMismatch
    );

    require!(
        msg.len() == ATTEST_MSG_LEN,
        ErrorCode::AttestationMsgWrongSize
    );
    require!(
        &msg[0..16] == ATTEST_DOMAIN,
        ErrorCode::AttestationDomainMismatch
    );

    let mut prog_bytes = [0u8; 32];
    prog_bytes.copy_from_slice(&msg[16..48]);
    require!(
        prog_bytes == program_id.to_bytes(),
        ErrorCode::AttestationProgramMismatch
    );

    let mut wallet_bytes = [0u8; 32];
    wallet_bytes.copy_from_slice(&msg[48..80]);
    require!(
        wallet_bytes == wallet_pda.to_bytes(),
        ErrorCode::AttestationWalletMismatch
    );

    let mut new_enclave_pubkey = [0u8; 32];
    new_enclave_pubkey.copy_from_slice(&msg[80..112]);

    let mut measurement_hash = [0u8; 32];
    measurement_hash.copy_from_slice(&msg[112..144]);

    let attestation_slot = u64::from_le_bytes(msg[144..152].try_into().unwrap());
    let expiry_slot = u64::from_le_bytes(msg[152..160].try_into().unwrap());
    let wallet_nonce = u64::from_le_bytes(msg[160..168].try_into().unwrap());

    require!(current_slot <= expiry_slot, ErrorCode::AttestationExpired);
    require!(
        wallet_nonce == expected_wallet_nonce,
        ErrorCode::AttestationNonceMismatch
    );

    Ok(AttestationFields {
        new_enclave_pubkey,
        measurement_hash,
        attestation_slot,
        expiry_slot,
        wallet_nonce,
    })
}

fn parse_ed25519_ix(data: &[u8]) -> Result<([u8; 32], Vec<u8>)> {
    require!(data.len() >= 16, ErrorCode::EdwardsIxMalformed);

    let count = data[0];
    require!(count == 1, ErrorCode::EdwardsIxCountUnsupported);

    let pk_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pk_ix_idx = u16::from_le_bytes([data[8], data[9]]);
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let msg_ix_idx = u16::from_le_bytes([data[14], data[15]]);

    require!(pk_ix_idx == u16::MAX, ErrorCode::EdwardsIxOffChainData);
    require!(msg_ix_idx == u16::MAX, ErrorCode::EdwardsIxOffChainData);

    require!(
        pk_offset
            .checked_add(32)
            .map_or(false, |end| end <= data.len()),
        ErrorCode::EdwardsIxMalformed
    );
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&data[pk_offset..pk_offset + 32]);

    require!(
        msg_offset
            .checked_add(msg_size)
            .map_or(false, |end| end <= data.len()),
        ErrorCode::EdwardsIxMalformed
    );
    let msg = data[msg_offset..msg_offset + msg_size].to_vec();

    Ok((pk, msg))
}
