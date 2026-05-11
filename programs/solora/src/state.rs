use anchor_lang::prelude::*;

pub const MAX_ALLOWED_PROGRAMS: usize = 16;
pub const MAX_CPI_REMAINING_ACCOUNTS: usize = 32;
pub const MAX_CPI_INSTRUCTION_DATA_LEN: usize = 1024;

/// Zero-copy on-chain wallet state. Layout chosen so `repr(C)` computes
/// no implicit padding — every gap is an explicit `_padding` field, which
/// is what `bytemuck::Pod` requires.
///
/// Account size = 8 (discriminator) + size_of::<SoloraWallet>() = 624 bytes.
#[account(zero_copy)]
#[repr(C)]
pub struct SoloraWallet {
    pub authority: Pubkey,      // 0..32
    pub enclave_signer: Pubkey, // 32..64
    pub policy: Policy,         // 64..592   (Policy is 528 bytes, align 8)
    pub nonce: u64,             // 592..600
    pub unlock_timestamp: i64,  // 600..608
    pub is_active: u8,          // 608       (0 = paused, 1 = active)
    pub _padding: [u8; 7],      // 609..616  (trailing alignment)
}

impl SoloraWallet {
    pub const SPACE: usize = 8 + core::mem::size_of::<Self>();

    #[inline]
    pub fn is_active_bool(&self) -> bool {
        self.is_active != 0
    }

    #[inline]
    pub fn set_active(&mut self, active: bool) {
        self.is_active = if active { 1 } else { 0 };
    }
}

#[zero_copy]
#[repr(C)]
pub struct Policy {
    pub max_trade_size_usdc: u64,                         // 0..8
    pub allowed_programs: [Pubkey; MAX_ALLOWED_PROGRAMS], // 8..520
    pub max_slippage_bps: u16,                            // 520..522
    pub allowed_count: u8,                                // 522
    pub _padding: [u8; 5],                                // 523..528
}

impl Policy {
    #[inline]
    pub fn allowed_slice(&self) -> &[Pubkey] {
        &self.allowed_programs[..self.allowed_count as usize]
    }

    #[inline]
    pub fn contains(&self, program: &Pubkey) -> bool {
        self.allowed_slice().iter().any(|p| p == program)
    }
}

pub const INTENT_DOMAIN: &[u8; 16] = b"SOLORA_INTENT_V2";
pub const INTENT_MSG_LEN: usize = 16 + 32 + 32 + 8 + 8 + 32 + 8 + 1 + 32;

pub const ATTEST_DOMAIN: &[u8; 16] = b"SOLORA_ATTEST_V1";
/// 16 (domain) + 32 (program_id) + 32 (wallet_pda) + 32 (new enclave pk)
/// + 32 (measurement) + 8 (attestation_slot) + 8 (expiry_slot) + 8 (wallet_nonce)
pub const ATTEST_MSG_LEN: usize = 16 + 32 + 32 + 32 + 32 + 8 + 8 + 8;

pub const SLOT_HASHES_ENTRY_SIZE: usize = 8 + 32;

pub const MAX_MEASUREMENTS: usize = 8;

pub const MEASUREMENT_STATUS_ACTIVE: u8 = 1;
pub const MEASUREMENT_STATUS_REVOKED: u8 = 0;

#[zero_copy]
#[repr(C)]
pub struct MeasurementEntry {
    /// `sha256(PCR0 || PCR1 || PCR2)` (Nitro) or platform-equivalent image hash.
    pub pcr_hash: [u8; 32],
    /// UTF-8 label, null-padded. Human-readable; not part of the security boundary.
    pub label: [u8; 32],
    /// Active = 1, Revoked = 0.
    pub status: u8,
    pub _padding: [u8; 7],
    pub added_slot: u64,
}

impl MeasurementEntry {
    pub const SIZE: usize = 32 + 32 + 1 + 7 + 8; // 80, align 8

    pub fn is_active(&self) -> bool {
        self.status == MEASUREMENT_STATUS_ACTIVE
    }
}

/// Singleton registry of trusted enclave measurements. Governor-controlled.
#[account(zero_copy)]
#[repr(C)]
pub struct MeasurementRegistry {
    /// Holder of the off-chain P-384 → Ed25519 verification gateway. Compromise
    /// of this key allows attestation forgery. Use a multisig or attest-the-
    /// governor-itself in production.
    pub governor: Pubkey,
    pub measurements: [MeasurementEntry; MAX_MEASUREMENTS],
    pub count: u8,
    pub _padding: [u8; 7],
}

impl MeasurementRegistry {
    pub const SPACE: usize = 8 + core::mem::size_of::<Self>();

    pub fn measurements_slice(&self) -> &[MeasurementEntry] {
        &self.measurements[..self.count as usize]
    }

    pub fn find_active(&self, pcr_hash: &[u8; 32]) -> Option<&MeasurementEntry> {
        self.measurements_slice()
            .iter()
            .find(|m| &m.pcr_hash == pcr_hash && m.is_active())
    }

    pub fn find_any(&self, pcr_hash: &[u8; 32]) -> Option<usize> {
        self.measurements_slice()
            .iter()
            .position(|m| &m.pcr_hash == pcr_hash)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum IntentKind {
    Transfer = 0,
    ArbitraryCpi = 1,
}

const _: [u8; 528] = [0; core::mem::size_of::<Policy>()];
const _: [u8; 616] = [0; core::mem::size_of::<SoloraWallet>()];
const _: [u8; 80] = [0; core::mem::size_of::<MeasurementEntry>()];
const _: [u8; 680] = [0; core::mem::size_of::<MeasurementRegistry>()];
