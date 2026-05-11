use async_trait::async_trait;
use serde::Deserialize;

use crate::error::{EnclaveError, EnclaveResult};

pub const SLOT_HASHES_SYSVAR_BASE58: &str = "SysvarS1otHashes111111111111111111111111111";

#[async_trait]
pub trait SolanaRpc: Send + Sync {

    async fn get_account_data(&self, address_base58: &str) -> EnclaveResult<Option<Vec<u8>>>;



    async fn get_most_recent_slot_hash(&self) -> EnclaveResult<(u64, [u8; 32])> {
        let data = self
            .get_account_data(SLOT_HASHES_SYSVAR_BASE58)
            .await?
            .ok_or_else(|| EnclaveError::Rpc("SlotHashes account missing".into()))?;
        if data.len() < 8 {
            return Err(EnclaveError::RpcResponse("SlotHashes too short".into()));
        }
        let count = u64::from_le_bytes(data[0..8].try_into().unwrap());
        if count == 0 {
            return Err(EnclaveError::RpcResponse("SlotHashes empty".into()));
        }
        if data.len() < 8 + 40 {
            return Err(EnclaveError::RpcResponse(
                "SlotHashes truncated mid-entry".into(),
            ));
        }
        let slot = u64::from_le_bytes(data[8..16].try_into().unwrap());
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&data[16..48]);
        Ok((slot, hash))
    }
}

pub struct HttpSolanaRpc {
    client: reqwest::Client,
    endpoint: String,
}

impl HttpSolanaRpc {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("rustls reqwest client"),
            endpoint: endpoint.into(),
        }
    }
}

#[derive(Deserialize)]
struct GetAccountInfoResponse {
    result: Option<GetAccountInfoResult>,
}
#[derive(Deserialize)]
struct GetAccountInfoResult {
    value: Option<GetAccountInfoValue>,
}
#[derive(Deserialize)]
struct GetAccountInfoValue {
    data: (String, String),
}

#[async_trait]
impl SolanaRpc for HttpSolanaRpc {
    async fn get_account_data(&self, address_base58: &str) -> EnclaveResult<Option<Vec<u8>>> {
        use base64::Engine;

        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAccountInfo",
            "params": [
                address_base58,
                { "encoding": "base64", "commitment": "confirmed" }
            ]
        });

        let resp = self
            .client
            .post(&self.endpoint)
            .json(&body)
            .send()
            .await
            .map_err(|e| EnclaveError::Rpc(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(EnclaveError::Rpc(format!("RPC HTTP {}", resp.status())));
        }

        let parsed: GetAccountInfoResponse = resp
            .json()
            .await
            .map_err(|e| EnclaveError::RpcResponse(e.to_string()))?;
        let result = match parsed.result {
            Some(r) => r,
            None => return Ok(None),
        };
        let value = match result.value {
            Some(v) => v,
            None => return Ok(None),
        };
        if value.data.1 != "base64" {
            return Err(EnclaveError::RpcResponse(format!(
                "expected base64 encoding, got {}",
                value.data.1
            )));
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(&value.data.0)?;
        Ok(Some(bytes))
    }
}

pub mod test_support {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    pub struct InMemoryRpc {
        accounts: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl InMemoryRpc {
        pub fn new() -> Self {
            Self {
                accounts: Mutex::new(HashMap::new()),
            }
        }

        pub fn set_account(&self, address: impl Into<String>, data: Vec<u8>) {
            self.accounts
                .lock()
                .expect("rpc test lock")
                .insert(address.into(), data);
        }
    }

    #[async_trait]
    impl SolanaRpc for InMemoryRpc {
        async fn get_account_data(&self, address: &str) -> EnclaveResult<Option<Vec<u8>>> {
            Ok(self
                .accounts
                .lock()
                .expect("rpc test lock")
                .get(address)
                .cloned())
        }
    }
}
