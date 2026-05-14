use std::time::Duration;

use async_trait::async_trait;
use rand::RngCore;
use reqwest::Client;
use serde::Deserialize;

use super::{coerce, AttestationDocument, AttestationProvider};
use crate::error::EnclaveResult;

const BACKEND_NAME: &str = "marlin-oyster";
const NONCE_LEN: usize = 32;
const HTTP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct MarlinOysterProvider {
    base_url: String,
    http: Client,
}

#[derive(Deserialize)]
struct OysterResponse {
    #[serde(default)]
    attestation_doc: Option<String>,
    #[serde(default)]
    attestation: Option<String>,
}

impl MarlinOysterProvider {
    pub fn new(base_url: impl Into<String>) -> Self {
        let http = Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .expect("reqwest client config valid");
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http,
        }
    }

    pub async fn probe(&self) -> EnclaveResult<()> {
        let url = format!("{}/attestation/raw", self.base_url);
        let resp = coerce(self.http.get(&url).send().await, "oyster probe")?;
        let status = resp.status();
        if !status.is_success() && status != reqwest::StatusCode::BAD_REQUEST {
            tracing::warn!(%status, "oyster attestation server returned unexpected status on probe");
        }
        Ok(())
    }
}

#[async_trait]
impl AttestationProvider for MarlinOysterProvider {
    async fn attest(&self, user_data: &[u8]) -> EnclaveResult<AttestationDocument> {
        let mut nonce = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce);

        let user_hex = hex::encode(user_data);
        let nonce_hex = hex::encode(nonce);

        let url = format!(
            "{}/attestation/raw?public_key={user_hex}&user_data={user_hex}&nonce={nonce_hex}",
            self.base_url
        );

        let resp = coerce(self.http.get(&url).send().await, "oyster attest")?;
        if !resp.status().is_success() {
            tracing::warn!(status = %resp.status(), "oyster attestation server returned non-2xx");
            return Err(crate::error::EnclaveError::AttestationUnavailable);
        }

        let body = coerce(resp.text().await, "oyster body")?;
        let hex_body = parse_hex_or_json(&body);
        let raw = coerce(hex::decode(hex_body.trim()), "oyster hex decode")?;

        Ok(AttestationDocument {
            raw,
            backend: BACKEND_NAME,
        })
    }

    fn backend_name(&self) -> &'static str {
        BACKEND_NAME
    }
}

fn parse_hex_or_json(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.starts_with('{') {
        if let Ok(parsed) = serde_json::from_str::<OysterResponse>(trimmed) {
            if let Some(hex) = parsed.attestation_doc.or(parsed.attestation) {
                return hex;
            }
        }
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_response_passthrough() {
        let body = "abcdef0123456789";
        assert_eq!(parse_hex_or_json(body), "abcdef0123456789");
    }

    #[test]
    fn parse_json_attestation_doc() {
        let body = r#"{"attestation_doc":"deadbeef"}"#;
        assert_eq!(parse_hex_or_json(body), "deadbeef");
    }

    #[test]
    fn parse_json_attestation_alt_key() {
        let body = r#"{"attestation":"cafebabe"}"#;
        assert_eq!(parse_hex_or_json(body), "cafebabe");
    }
}
