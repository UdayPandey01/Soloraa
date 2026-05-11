use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sdk_ids::ed25519_program;
use solana_sdk_ids::sysvar::instructions::ID as IX_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_ID;

use crate::error::ErrorCode;
use crate::state::{IntentKind, INTENT_DOMAIN, INTENT_MSG_LEN, SLOT_HASHES_ENTRY_SIZE};

pub struct VerifiedIntent {
    pub nonce: u64,
    pub expiry_slot: u64,
    pub kind: u8,
    pub payload_hash: [u8; 32],
}

#[allow(clippy::too_many_arguments)]
pub fn verify_enclave_intent(
    ix_sysvar: &AccountInfo,
    slot_hashes_sysvar: &AccountInfo,
    program_id: &Pubkey,
    wallet_pda: &Pubkey,
    expected_signer: &Pubkey,
    expected_kind: IntentKind,
    expected_payload_hash: &[u8; 32],
    expected_nonce: u64,
    current_slot: u64,
) -> Result<VerifiedIntent> {
    require_keys_eq!(ix_sysvar.key(), IX_SYSVAR_ID, ErrorCode::InvalidIxSysvar);
    require_keys_eq!(
        slot_hashes_sysvar.key(),
        SLOT_HASHES_ID,
        ErrorCode::InvalidSlotHashesSysvar
    );

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
        sig_pubkey == expected_signer.to_bytes(),
        ErrorCode::EnclaveSignerMismatch
    );

    require!(msg.len() == INTENT_MSG_LEN, ErrorCode::IntentMsgWrongSize);
    require!(
        &msg[0..16] == INTENT_DOMAIN,
        ErrorCode::IntentDomainMismatch
    );

    let mut prog_bytes = [0u8; 32];
    prog_bytes.copy_from_slice(&msg[16..48]);
    require!(
        prog_bytes == program_id.to_bytes(),
        ErrorCode::IntentProgramMismatch
    );

    let mut wallet_bytes = [0u8; 32];
    wallet_bytes.copy_from_slice(&msg[48..80]);
    require!(
        wallet_bytes == wallet_pda.to_bytes(),
        ErrorCode::IntentWalletMismatch
    );

    let mut nonce_bytes = [0u8; 8];
    nonce_bytes.copy_from_slice(&msg[80..88]);
    let nonce = u64::from_le_bytes(nonce_bytes);
    require!(nonce == expected_nonce, ErrorCode::IntentNonceMismatch);

    let mut expiry_bytes = [0u8; 8];
    expiry_bytes.copy_from_slice(&msg[88..96]);
    let expiry_slot = u64::from_le_bytes(expiry_bytes);
    require!(current_slot <= expiry_slot, ErrorCode::IntentExpired);

    let mut signed_blockhash = [0u8; 32];
    signed_blockhash.copy_from_slice(&msg[96..128]);
    let mut bh_slot_bytes = [0u8; 8];
    bh_slot_bytes.copy_from_slice(&msg[128..136]);
    let blockhash_slot = u64::from_le_bytes(bh_slot_bytes);

    let slot_hashes_data = slot_hashes_sysvar
        .try_borrow_data()
        .map_err(|_| error!(ErrorCode::SlotHashesAccountInvalid))?;
    let onchain_hash = lookup_slot_hash(&slot_hashes_data, blockhash_slot)?
        .ok_or(error!(ErrorCode::BlockhashSlotNotFound))?;
    require!(
        onchain_hash == signed_blockhash,
        ErrorCode::BlockhashMismatch
    );

    let kind = msg[136];
    require!(kind == expected_kind as u8, ErrorCode::IntentKindMismatch);

    let mut hash_bytes = [0u8; 32];
    hash_bytes.copy_from_slice(&msg[137..169]);
    require!(
        &hash_bytes == expected_payload_hash,
        ErrorCode::IntentPayloadMismatch
    );

    Ok(VerifiedIntent {
        nonce,
        expiry_slot,
        kind,
        payload_hash: hash_bytes,
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

fn lookup_slot_hash(data: &[u8], target_slot: u64) -> Result<Option<[u8; 32]>> {
    require!(data.len() >= 8, ErrorCode::SlotHashesAccountInvalid);
    let count = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
    let entries = &data[8..];
    let needed = count
        .checked_mul(SLOT_HASHES_ENTRY_SIZE)
        .ok_or(error!(ErrorCode::SlotHashesAccountInvalid))?;
    require!(entries.len() >= needed, ErrorCode::SlotHashesAccountInvalid);

    let mut lo = 0usize;
    let mut hi = count;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let off = mid * SLOT_HASHES_ENTRY_SIZE;
        let slot = u64::from_le_bytes(entries[off..off + 8].try_into().unwrap());
        if slot == target_slot {
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&entries[off + 8..off + 40]);
            return Ok(Some(hash));
        } else if slot < target_slot {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    Ok(None)
}
