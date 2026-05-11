use bytemuck::{Pod, Zeroable};

use crate::error::{EnclaveError, EnclaveResult};

pub const ANCHOR_DISCRIMINATOR_LEN: usize = 8;
pub const MAX_ALLOWED_PROGRAMS: usize = 16;

pub const SOLORA_WALLET_DISCRIMINATOR: [u8; 8] = [170, 18, 86, 95, 106, 12, 175, 27];

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct Policy {
    pub max_trade_size_usdc: u64,
    pub allowed_programs: [[u8; 32]; MAX_ALLOWED_PROGRAMS],
    pub max_slippage_bps: u16,
    pub allowed_count: u8,
    pub _padding: [u8; 5],
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct SoloraWallet {
    pub authority: [u8; 32],
    pub enclave_signer: [u8; 32],
    pub policy: Policy,
    pub nonce: u64,
    pub unlock_timestamp: i64,
    pub is_active: u8,
    pub _padding: [u8; 7],
}

impl SoloraWallet {
    pub const SIZE: usize = core::mem::size_of::<Self>();


    pub fn from_account_data(data: &[u8]) -> EnclaveResult<&Self> {
        let total_needed = ANCHOR_DISCRIMINATOR_LEN + Self::SIZE;
        if data.len() < total_needed {
            return Err(EnclaveError::WalletAccountTooShort(data.len()));
        }
        if data[..ANCHOR_DISCRIMINATOR_LEN] != SOLORA_WALLET_DISCRIMINATOR {
            return Err(EnclaveError::WalletAccountWrongDiscriminator);
        }
        let body = &data[ANCHOR_DISCRIMINATOR_LEN..total_needed];
        bytemuck::try_from_bytes::<SoloraWallet>(body)
            .map_err(|_| EnclaveError::WalletAccountAlignment)
    }

    pub fn is_active_bool(&self) -> bool {
        self.is_active != 0
    }
}

impl Policy {
    pub fn allowed_slice(&self) -> &[[u8; 32]] {
        &self.allowed_programs[..self.allowed_count as usize]
    }

    pub fn contains(&self, target: &[u8; 32]) -> bool {
        self.allowed_slice().iter().any(|p| p == target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synth_wallet() -> Vec<u8> {
        let mut wallet = SoloraWallet::zeroed();
        wallet.authority = [0xAA; 32];
        wallet.enclave_signer = [0xBB; 32];
        wallet.is_active = 1;
        wallet.nonce = 42;
        wallet.unlock_timestamp = 0;
        wallet.policy.max_trade_size_usdc = 1_000_000;
        wallet.policy.max_slippage_bps = 50;
        wallet.policy.allowed_count = 1;
        wallet.policy.allowed_programs[0] = [0xCC; 32];

        let mut out = Vec::with_capacity(ANCHOR_DISCRIMINATOR_LEN + SoloraWallet::SIZE);
        out.extend_from_slice(&SOLORA_WALLET_DISCRIMINATOR);
        out.extend_from_slice(bytemuck::bytes_of(&wallet));
        out
    }

    #[test]
    fn round_trip_decode() {
        let bytes = synth_wallet();
        let w = SoloraWallet::from_account_data(&bytes).unwrap();
        assert!(w.is_active_bool());
        assert_eq!(w.nonce, 42);
        assert_eq!(w.policy.max_trade_size_usdc, 1_000_000);
        assert_eq!(w.policy.max_slippage_bps, 50);
        assert_eq!(w.policy.allowed_count, 1);
        assert!(w.policy.contains(&[0xCC; 32]));
        assert!(!w.policy.contains(&[0xDD; 32]));
    }

    #[test]
    fn rejects_wrong_discriminator() {
        let mut bytes = synth_wallet();
        bytes[0] = 0;
        assert!(matches!(
            SoloraWallet::from_account_data(&bytes),
            Err(EnclaveError::WalletAccountWrongDiscriminator)
        ));
    }

    #[test]
    fn rejects_short_buffer() {
        let bytes = synth_wallet();
        assert!(matches!(
            SoloraWallet::from_account_data(&bytes[..50]),
            Err(EnclaveError::WalletAccountTooShort(_))
        ));
    }

    #[test]
    fn struct_size_matches_chain_layout() {

        assert_eq!(core::mem::size_of::<Policy>(), 528);
        assert_eq!(SoloraWallet::SIZE, 616);
    }
}
