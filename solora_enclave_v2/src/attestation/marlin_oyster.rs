//! Marlin Oyster attestation client.
//!
//! Marlin's Oyster CVM runs the enclave image inside an AWS Nitro / Intel TDX
//! confidential VM. Alongside the user image, Marlin runs a small "attestation
//! server" on a fixed local port (default `1300`). The image fetches an
//! attestation by issuing:
//!
//! ```text
//! GET ${OYSTER_ATTEST_URL}/attestation/raw
//!     ?public_key=<hex>
//!     &user_data=<hex>
//!     &nonce=<hex>
//! ```
//!
//! The response is the hex-encoded raw AWS Nitro NSM attestation document
//! (CBOR-encoded COSE-Sign1). This struct issues the request and returns the
//! bytes — interpretation happens off-chain at the governor.
//!
//! References:
//!   - Marlin Oyster CVM docs: https://docs.marlin.org/learn/oyster/core-concepts/tee
//!   - AWS Nitro attestation format: https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-attestation-process.html

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
    /// Hex-encoded raw attestation document.
    #[serde(default)]
    attestation_doc: Option<String>,
    /// Some Oyster versions return `attestation` instead; accept both.
    #[serde(default)]
    attestation: Option<String>,
}

impl MarlinOysterProvider {
    /// Build a provider for the Oyster CVM's local attestation server.
    /// `base_url` typically points at `http://127.0.0.1:1300`.
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

    /// Liveness probe — succeeds if the local attestation server responds.
    /// Used on startup to fail fast when the operator selected Marlin Oyster
    /// but the CVM environment isn't actually exposing the endpoint.
    pub async fn probe(&self) -> EnclaveResult<()> {
        // Many Oyster versions expose /attestation/raw as the canonical path
        // and don't define a separate /health endpoint. A GET with no args
        // returns 400 or 200 depending on version; either tells us the
        // server is responsive.
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

        // `public_key` and `user_data` are the same field in the NSM payload
        // when the producer is also the consumer. We set both so older Oyster
        // versions populate either correctly.
        let url = format!(
            "{}/attestation/raw?public_key={user_hex}&user_data={user_hex}&nonce={nonce_hex}",
            self.base_url
        );

        let resp = coerce(self.http.get(&url).send().await, "oyster attest")?;
        if !resp.status().is_success() {
            tracing::warn!(status = %resp.status(), "oyster attestation server returned non-2xx");
            return Err(crate::error::EnclaveError::AttestationUnavailable);
        }

        // The Oyster server returns either:
        //   - raw hex bytes as the body, OR
        //   - a JSON envelope { "attestation_doc": "<hex>" } / { "attestation": "<hex>" }
        // We accept both.
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
