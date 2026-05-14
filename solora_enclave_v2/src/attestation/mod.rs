use async_trait::async_trait;

use crate::error::{EnclaveError, EnclaveResult};

mod marlin_oyster;
mod unattested;

pub use marlin_oyster::MarlinOysterProvider;
pub use unattested::Unattested;

#[derive(Debug, Clone)]
pub struct AttestationDocument {
    pub raw: Vec<u8>,
    pub backend: &'static str,
}

#[async_trait]
pub trait AttestationProvider: Send + Sync {
    async fn attest(&self, user_data: &[u8]) -> EnclaveResult<AttestationDocument>;
    fn backend_name(&self) -> &'static str;
}

pub(crate) fn coerce<T, E: std::fmt::Display>(
    result: Result<T, E>,
    context: &'static str,
) -> EnclaveResult<T> {
    result.map_err(|err| {
        tracing::warn!(context, error = %err, "attestation backend error");
        EnclaveError::AttestationUnavailable
    })
}
