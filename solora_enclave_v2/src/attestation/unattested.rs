use async_trait::async_trait;

use super::{AttestationDocument, AttestationProvider};
use crate::error::{EnclaveError, EnclaveResult};

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
