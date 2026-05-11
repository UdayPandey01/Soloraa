use async_trait::async_trait;

use crate::error::{EnclaveError, EnclaveResult};

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
