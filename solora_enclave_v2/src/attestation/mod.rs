//! Attestation backends.
//!
//! Solora's trust model splits attestation in two:
//!
//! 1. **Inside the enclave** (this module) — produce an attestation document
//!    that binds the enclave's Ed25519 pubkey to the TEE's PCR measurements.
//!    The document is opaque bytes; we don't verify it here. The producing
//!    backend is one of:
//!      - [`Unattested`]: dev only, returns an error.
//!      - [`MarlinOysterProvider`]: production. Fetches from the Oyster CVM's
//!        local attestation server.
//!
//! 2. **Off-chain governor** (in `solora_relayer/oyster_attestation.ts`) —
//!    parses the document, verifies the COSE-Sign1 signature against the
//!    AWS Nitro PKI root, extracts PCR0, and signs the (PCR0, enclave_pubkey)
//!    tuple with its Ed25519 key.
//!
//! 3. **On-chain** (`programs/solora/src/lib.rs`) — verifies the governor's
//!    Ed25519 signature and registers the measurement.

use async_trait::async_trait;

use crate::error::{EnclaveError, EnclaveResult};

mod marlin_oyster;
mod unattested;

pub use marlin_oyster::MarlinOysterProvider;
pub use unattested::Unattested;

/// Attestation document returned by an [`AttestationProvider`]. The bytes are
/// opaque at this layer — interpretation depends on the producing backend
/// and happens off-chain at the governor.
#[derive(Debug, Clone)]
pub struct AttestationDocument {
    /// Raw bytes of the attestation document. For Nitro-backed CVMs (the
    /// Marlin Oyster default) this is a CBOR-encoded COSE-Sign1 envelope.
    pub raw: Vec<u8>,

    /// Backend identifier (e.g. `"marlin-oyster"`, `"unattested"`). Used by
    /// the governor and audit logs to pick the right parser.
    pub backend: &'static str,
}

#[async_trait]
pub trait AttestationProvider: Send + Sync {
    /// Produce an attestation document binding `user_data` (the enclave's
    /// Ed25519 pubkey bytes, 32 B) into the TEE's signed payload.
    ///
    /// Implementations should also embed a fresh nonce and a current
    /// timestamp so the governor can reject stale attestations.
    async fn attest(&self, user_data: &[u8]) -> EnclaveResult<AttestationDocument>;

    /// Stable backend name. Surfaces in audit logs and the governor's
    /// dispatch table — do not change without a coordinated update.
    fn backend_name(&self) -> &'static str;
}

/// Helper: convert any backend error into [`EnclaveError::AttestationUnavailable`]
/// so callers don't need to know about backend-specific failure modes.
pub(crate) fn coerce<T, E: std::fmt::Display>(
    result: Result<T, E>,
    context: &'static str,
) -> EnclaveResult<T> {
    result.map_err(|err| {
        tracing::warn!(context, error = %err, "attestation backend error");
        EnclaveError::AttestationUnavailable
    })
}
