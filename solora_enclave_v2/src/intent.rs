use sha2::{Digest, Sha256};

use crate::error::{EnclaveError, EnclaveResult};

pub const INTENT_DOMAIN_V2: &[u8; 16] = b"SOLORA_INTENT_V2";
pub const INTENT_MSG_LEN: usize = 169;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum IntentKind {
    Transfer = 0,
    ArbitraryCpi = 1,
}

#[derive(Debug, Clone)]
pub struct IntentMessageInputs<'a> {
    pub program_id: &'a [u8; 32],
    pub wallet_pda: &'a [u8; 32],
    pub nonce: u64,
    pub expiry_slot: u64,
    pub recent_blockhash: &'a [u8; 32],
    pub blockhash_slot: u64,
    pub kind: IntentKind,
    pub payload_hash: &'a [u8; 32],
}

pub fn build_intent_message(input: IntentMessageInputs<'_>) -> [u8; INTENT_MSG_LEN] {
    let mut buf = [0u8; INTENT_MSG_LEN];
    buf[0..16].copy_from_slice(INTENT_DOMAIN_V2);
    buf[16..48].copy_from_slice(input.program_id);
    buf[48..80].copy_from_slice(input.wallet_pda);
    buf[80..88].copy_from_slice(&input.nonce.to_le_bytes());
    buf[88..96].copy_from_slice(&input.expiry_slot.to_le_bytes());
    buf[96..128].copy_from_slice(input.recent_blockhash);
    buf[128..136].copy_from_slice(&input.blockhash_slot.to_le_bytes());
    buf[136] = input.kind as u8;
    buf[137..169].copy_from_slice(input.payload_hash);
    buf
}

pub fn require_canonical_msg_len(msg: &[u8]) -> EnclaveResult<()> {
    if msg.len() != INTENT_MSG_LEN {
        return Err(EnclaveError::IntentMsgWrongSize(msg.len()));
    }
    Ok(())
}

pub fn transfer_payload_hash(destination: &[u8; 32], amount: u64) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update([IntentKind::Transfer as u8]);
    h.update(destination);
    h.update(amount.to_le_bytes());
    h.finalize().into()
}

#[derive(Debug, Clone, Copy)]
pub struct AccountMetaFlags {
    pub is_signer: bool,
    pub is_writable: bool,
}

pub fn arbitrary_cpi_payload_hash(
    target_program: &[u8; 32],
    instruction_data: &[u8],
    account_metas: &[(&[u8; 32], AccountMetaFlags)],
) -> [u8; 32] {
    let ix_data_hash: [u8; 32] = {
        let mut h = Sha256::new();
        h.update(instruction_data);
        h.finalize().into()
    };

    let accounts_hash: [u8; 32] = {
        let mut h = Sha256::new();
        for (key, flags) in account_metas {
            h.update(key.as_slice());
            h.update([if flags.is_signer { 1 } else { 0 }]);
            h.update([if flags.is_writable { 1 } else { 0 }]);
        }
        h.finalize().into()
    };

    let mut h = Sha256::new();
    h.update([IntentKind::ArbitraryCpi as u8]);
    h.update(target_program);
    h.update(ix_data_hash);
    h.update(accounts_hash);
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_layout_matches_chain_offsets() {
        let program_id = [1u8; 32];
        let wallet_pda = [2u8; 32];
        let recent_blockhash = [3u8; 32];
        let payload_hash = [4u8; 32];
        let msg = build_intent_message(IntentMessageInputs {
            program_id: &program_id,
            wallet_pda: &wallet_pda,
            nonce: 7,
            expiry_slot: 99,
            recent_blockhash: &recent_blockhash,
            blockhash_slot: 12345,
            kind: IntentKind::Transfer,
            payload_hash: &payload_hash,
        });

        assert_eq!(msg.len(), 169);
        assert_eq!(&msg[0..16], INTENT_DOMAIN_V2);
        assert_eq!(&msg[16..48], &program_id);
        assert_eq!(&msg[48..80], &wallet_pda);
        assert_eq!(u64::from_le_bytes(msg[80..88].try_into().unwrap()), 7);
        assert_eq!(u64::from_le_bytes(msg[88..96].try_into().unwrap()), 99);
        assert_eq!(&msg[96..128], &recent_blockhash);
        assert_eq!(u64::from_le_bytes(msg[128..136].try_into().unwrap()), 12345);
        assert_eq!(msg[136], 0u8);
        assert_eq!(&msg[137..169], &payload_hash);
    }

    #[test]
    fn transfer_payload_hash_is_deterministic() {
        let dst = [9u8; 32];
        let h1 = transfer_payload_hash(&dst, 1_000_000);
        let h2 = transfer_payload_hash(&dst, 1_000_000);
        assert_eq!(h1, h2);
        let h3 = transfer_payload_hash(&dst, 1_000_001);
        assert_ne!(h1, h3);
    }
}
