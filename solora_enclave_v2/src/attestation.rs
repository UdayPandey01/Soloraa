//! Attestation provider abstraction.
//!
//! In production the enclave embeds the binding `attestation_user_data ==
//! enclave_pubkey` in its quote. The on-chain `register_enclave` instruction
//! (or its successor) verifies the quote and only accepts enclave-signed
//! intents from a key whose pubkey matches the attestation's user_data and
//! whose PCRs match the expected enclave measurement.
//!
//! Concrete implementations:
//!   - **AWS Nitro NSM**: call `/dev/nsm` ioctl with the user's 32-byte pubkey
//!     in `user_data`. The returned attestation document is a CBOR-encoded
//!     COSE Sign1 with a chain rooted at AWS's Nitro root cert. Verification
//!     happens on-chain (via a separate Solana program that reads ROOT) or
//!     via a relayer-side helper.
//!   - **Marlin Oyster**: HTTP request to the local Marlin agent for an
//!     attestation document; signed by Marlin's KMS root.
//!
//! For this milestone we ship `Unattested`, which honestly returns
//! `AttestationUnavailable`. The trait shape is the contract real backends
//! will satisfy. We intentionally do NOT ship a fake quote.

use async_trait::async_trait;

use crate::error::{EnclaveError, EnclaveResult};

#[derive(Debug, Clone)]
pub struct AttestationDocument {
    /// COSE-signed (Nitro) or Marlin-KMS-signed bytes. Format depends on backend.
    pub raw: Vec<u8>,
    /// What attestation backend produced this. Hint for the verifier.
    pub backend: &'static str,
}

#[async_trait]
pub trait AttestationProvider: Send + Sync {
    /// Produce an attestation that binds `user_data` (typically the 32-byte
    /// enclave pubkey) to the running enclave's measurement (PCR0..PCR8 on
    /// Nitro, image-hash + boot-hash on Marlin).
    async fn attest(&self, user_data: &[u8]) -> EnclaveResult<AttestationDocument>;

    fn backend_name(&self) -> &'static str;
}

/// Stub provider for non-enclave runs (local dev, CI). Returns an explicit
/// error rather than a fake document so misconfigured deployments surface
/// loudly instead of pretending to be attested.
pub struct Unattested;

#[async_trait]
impl AttestationProvider for Unattested {
    async fn attest(&self, _user_data: &[u8]) -> EnclaveResult<AttestationDocument> {
        Err(EnclaveError::AttestationUnavailable)
    }

    fn backend_name(&self) -> &'static str {
        "unattested"
    }
}
