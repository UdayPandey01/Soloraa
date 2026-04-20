#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(clippy::arithmetic_side_effects)]
#![allow(clippy::cast_sign_loss)]
#![allow(clippy::too_many_arguments)]

#[ink::contract]
mod solora_enclave {
    use base64ct::{Base64, Encoding};
    use core::convert::TryFrom;
    use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
    use ink::prelude::{format, string::String, vec, vec::Vec};
    use pink_extension as pink;
    use pink_json as json;
    use rand_core::{CryptoRng, RngCore};
    use serde::Deserialize;

    const RPC_CONSENSUS_COUNT: usize = 3;
    const SOLORA_ACCOUNT_MIN_LEN: usize = 8 + 32 + 32 + 1 + 8 + 2 + 8;

    struct SgxRng;
    impl RngCore for SgxRng {
        fn next_u32(&mut self) -> u32 {
            let mut bytes = [0u8; 4];
            self.fill_bytes(&mut bytes);
            u32::from_le_bytes(bytes)
        }
        fn next_u64(&mut self) -> u64 {
            let mut bytes = [0u8; 8];
            self.fill_bytes(&mut bytes);
            u64::from_le_bytes(bytes)
        }
        fn fill_bytes(&mut self, dest: &mut [u8]) {
            let mut written = 0usize;
            while written < dest.len() {
                let remaining = dest.len() - written;
                let req = core::cmp::min(remaining, u8::MAX as usize);
                let req_u8 = u8::try_from(req).expect("req is clamped to u8::MAX");
                let random_bytes = pink::ext().getrandom(req_u8);
                let chunk_len = random_bytes.len();
                dest[written..written + chunk_len].copy_from_slice(&random_bytes);
                written += chunk_len;
            }
        }
        fn try_fill_bytes(
            &mut self,
            dest: &mut [u8],
        ) -> core::result::Result<(), rand_core::Error> {
            self.fill_bytes(dest);
            Ok(())
        }
    }
    impl CryptoRng for SgxRng {}

    #[derive(scale::Encode, scale::Decode, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
    pub enum ErrorCode {
        UnauthorizedUser,
        InvalidRuntimeConfig,
        RpcConsensusFailed,
        RpcRequestFailed,
        RpcResponseInvalid,
        PolicyDecodeFailed,
        OracleFetchFailed,
        OracleVerificationFailed,
        PriceMathFailed,
    }

    pub type Result<T> = core::result::Result<T, ErrorCode>;

    #[ink(storage)]
    pub struct SoloraEnclave {
        authority: AccountId,
        enclave_pubkey: [u8; 32],
        enclave_private_key: [u8; 32],
        rpc_endpoints: Vec<String>,
        pyth_hermes_base_url: String,
        pyth_guardian_pubkeys: Vec<[u8; 32]>,
    }

    #[derive(Deserialize)]
    struct RpcResponse {
        result: Option<RpcResult>,
    }
    #[derive(Deserialize)]
    struct RpcResult {
        context: RpcContext,
        value: Option<RpcValue>,
    }
    #[derive(Deserialize)]
    struct RpcContext {
        slot: u64,
    }
    #[derive(Deserialize)]
    struct RpcValue {
        data: (String, String),
    }

    #[derive(Clone, PartialEq, Eq)]
    struct RpcSnapshot {
        slot: u64,
        data: Vec<u8>,
    }

    #[derive(Clone, Copy)]
    struct PolicySnapshot {
        max_trade_size_usdc: u64,
        max_slippage_bps: u16,
        is_active: bool,
    }

    #[derive(Deserialize)]
    struct HermesResponse {
        vaa: String,
        signatures: Vec<HermesSignature>,
        parsed_price: HermesParsedPrice,
    }
    #[derive(Deserialize)]
    struct HermesSignature {
        guardian_index: u8,
        signature: String,
    }
    #[derive(Deserialize)]
    struct HermesParsedPrice {
        price: i64,
        expo: i32,
        conf: u64,
    }

    #[derive(Clone, Copy)]
    struct VerifiedPrice {
        price_e8: i64,
        conf_e8: u64,
    }

    impl SoloraEnclave {
        #[ink(constructor)]
        pub fn new() -> Self {
            let mut rng = SgxRng;
            let mut secret_bytes = [0u8; 32];
            rng.fill_bytes(&mut secret_bytes);

            let signing_key = SigningKey::from_bytes(&secret_bytes);
            let verifying_key = signing_key.verifying_key();

            Self {
                authority: Self::env().caller(),
                enclave_pubkey: verifying_key.to_bytes(),
                enclave_private_key: secret_bytes,
                rpc_endpoints: Vec::new(),
                pyth_hermes_base_url: String::new(),
                pyth_guardian_pubkeys: Vec::new(),
            }
        }

        #[ink(message)]
        pub fn get_public_key(&self) -> [u8; 32] {
            self.enclave_pubkey
        }

        #[ink(message)]
        pub fn configure_data_ingress(
            &mut self,
            rpc_endpoints: Vec<String>,
            pyth_hermes_base_url: String,
            pyth_guardian_pubkeys: Vec<[u8; 32]>,
        ) -> Result<()> {
            if self.env().caller() != self.authority {
                return Err(ErrorCode::UnauthorizedUser);
            }
            if rpc_endpoints.len() != RPC_CONSENSUS_COUNT || pyth_guardian_pubkeys.is_empty() {
                return Err(ErrorCode::InvalidRuntimeConfig);
            }

            self.rpc_endpoints = rpc_endpoints;
            self.pyth_hermes_base_url = pyth_hermes_base_url;
            self.pyth_guardian_pubkeys = pyth_guardian_pubkeys;
            Ok(())
        }

        #[ink(message)]
        pub fn execute_trade_intent(
            &self,
            trade_size_usdc: u64,
            expected_slippage_bps: u16,
            side_is_buy: bool,
            limit_price_e8: i64,
            wallet_pda_base58: String,
            pyth_feed_id_hex: String,
            tx_hash_to_sign: [u8; 32],
        ) -> core::result::Result<[u8; 64], String> {
            let policy = self
                .fetch_policy_with_consensus(&wallet_pda_base58)
                .map_err(|_| String::from("failed to verify policy from rpc consensus"))?;

            if !policy.is_active {
                return Err(String::from("wallet is paused on chain"));
            }
            if trade_size_usdc > policy.max_trade_size_usdc {
                return Err(String::from("policy max trade exceeded"));
            }
            if expected_slippage_bps > policy.max_slippage_bps {
                return Err(String::from("policy max slippage exceeded"));
            }

            let price = self
                .fetch_and_verify_pyth_price(&pyth_feed_id_hex)
                .map_err(|_| String::from("failed to verify pyth price"))?;

            let execution_price = self
                .expected_execution_price_e8(price, side_is_buy)
                .map_err(|_| String::from("execution price math failed"))?;

            let slip = self
                .compute_slippage_bps(limit_price_e8, execution_price)
                .map_err(|_| String::from("slippage math failed"))?;

            if slip > policy.max_slippage_bps {
                return Err(String::from("slippage exceeds policy max"));
            }
            if slip > expected_slippage_bps {
                return Err(String::from("slippage exceeds intent max"));
            }

            let key = SigningKey::from_bytes(&self.enclave_private_key);
            let sig = key.sign(&tx_hash_to_sign);

            pink::info!("Intent Approved & Signed.");
            Ok(sig.to_bytes())
        }


        fn fetch_policy_with_consensus(&self, wallet_pda_base58: &str) -> Result<PolicySnapshot> {
            if self.rpc_endpoints.len() != RPC_CONSENSUS_COUNT {
                return Err(ErrorCode::InvalidRuntimeConfig);
            }

            let mut snapshots: Vec<RpcSnapshot> = Vec::with_capacity(RPC_CONSENSUS_COUNT);
            for endpoint in self.rpc_endpoints.iter() {
                snapshots.push(self.fetch_rpc_snapshot(endpoint, wallet_pda_base58)?);
            }

            let mut winner: Option<usize> = None;
            for i in 0..snapshots.len() {
                let mut cnt = 1usize;
                for j in 0..snapshots.len() {
                    if i != j && snapshots[i] == snapshots[j] {
                        cnt += 1;
                    }
                }
                if cnt >= 2 {
                    winner = Some(i);
                    break;
                }
            }

            let idx = winner.ok_or(ErrorCode::RpcConsensusFailed)?;
            self.decode_policy_from_wallet_data(&snapshots[idx].data)
        }

        fn fetch_rpc_snapshot(
            &self,
            endpoint: &str,
            wallet_pda_base58: &str,
        ) -> Result<RpcSnapshot> {
            let body = format!(
                "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"{}\",{{\"encoding\":\"base64\",\"commitment\":\"finalized\"}}]}}",
                wallet_pda_base58
            ).into_bytes();

            let headers = vec![(
                String::from("content-type"),
                String::from("application/json"),
            )];
            let response = pink::http_post!(endpoint, body, headers);

            if response.status_code != 200 {
                return Err(ErrorCode::RpcRequestFailed);
            }

            let parsed: RpcResponse =
                json::from_slice(&response.body).map_err(|_| ErrorCode::RpcResponseInvalid)?;
            let result = parsed.result.ok_or(ErrorCode::RpcResponseInvalid)?;
            let value = result.value.ok_or(ErrorCode::RpcResponseInvalid)?;
            if value.data.1 != "base64" {
                return Err(ErrorCode::RpcResponseInvalid);
            }

            let mut out = vec![0u8; value.data.0.len()];
            let decoded_len = {
                let decoded = Base64::decode(&value.data.0, &mut out)
                    .map_err(|_| ErrorCode::RpcResponseInvalid)?;
                decoded.len()
            };
            out.truncate(decoded_len);

            Ok(RpcSnapshot {
                slot: result.context.slot,
                data: out,
            })
        }

        fn decode_policy_from_wallet_data(&self, data: &[u8]) -> Result<PolicySnapshot> {
            if data.len() < SOLORA_ACCOUNT_MIN_LEN {
                return Err(ErrorCode::PolicyDecodeFailed);
            }

            let is_active = data[72] != 0;
            let max_trade_size_usdc = {
                let mut v = [0u8; 8];
                v.copy_from_slice(&data[73..81]);
                u64::from_le_bytes(v)
            };
            let max_slippage_bps = {
                let mut v = [0u8; 2];
                v.copy_from_slice(&data[81..83]);
                u16::from_le_bytes(v)
            };

            Ok(PolicySnapshot {
                max_trade_size_usdc,
                max_slippage_bps,
                is_active,
            })
        }

        fn fetch_and_verify_pyth_price(&self, feed_id_hex: &str) -> Result<VerifiedPrice> {
            if self.pyth_guardian_pubkeys.is_empty() || self.pyth_hermes_base_url.is_empty() {
                return Err(ErrorCode::InvalidRuntimeConfig);
            }

            let url = format!(
                "{}/v2/updates/price/latest?ids[]={}",
                self.pyth_hermes_base_url, feed_id_hex
            );
            let response = pink::http_get!(&url, Vec::new());
            if response.status_code != 200 {
                return Err(ErrorCode::OracleFetchFailed);
            }

            let parsed: HermesResponse =
                json::from_slice(&response.body).map_err(|_| ErrorCode::OracleFetchFailed)?;

            let mut vaa_bytes = vec![0u8; parsed.vaa.len()];
            let vaa_decoded_len = {
                let vaa_decoded = Base64::decode(&parsed.vaa, &mut vaa_bytes)
                    .map_err(|_| ErrorCode::OracleFetchFailed)?;
                vaa_decoded.len()
            };
            vaa_bytes.truncate(vaa_decoded_len);

            self.verify_pyth_signatures(&vaa_bytes, &parsed.signatures)?;

            let price_e8 = self.scale_to_e8(parsed.parsed_price.price, parsed.parsed_price.expo)?;
            let conf_e8 =
                self.scale_to_e8_u64(parsed.parsed_price.conf, parsed.parsed_price.expo)?;
            Ok(VerifiedPrice { price_e8, conf_e8 })
        }

        fn verify_pyth_signatures(
            &self,
            vaa_payload: &[u8],
            signatures: &[HermesSignature],
        ) -> Result<()> {
            let quorum = ((self.pyth_guardian_pubkeys.len() * 2) / 3) + 1;
            let mut valid = 0usize;

            for s in signatures.iter() {
                let idx = s.guardian_index as usize;
                if idx >= self.pyth_guardian_pubkeys.len() {
                    continue;
                }

                let pk = VerifyingKey::from_bytes(&self.pyth_guardian_pubkeys[idx])
                    .map_err(|_| ErrorCode::OracleVerificationFailed)?;
                let sig_bytes =
                    hex::decode(&s.signature).map_err(|_| ErrorCode::OracleVerificationFailed)?;
                if sig_bytes.len() != 64 {
                    continue;
                }

                let sig = Signature::from_slice(&sig_bytes)
                    .map_err(|_| ErrorCode::OracleVerificationFailed)?;
                if pk.verify(vaa_payload, &sig).is_ok() {
                    valid += 1;
                }
            }

            if valid < quorum {
                return Err(ErrorCode::OracleVerificationFailed);
            }
            Ok(())
        }

        fn expected_execution_price_e8(
            &self,
            price: VerifiedPrice,
            side_is_buy: bool,
        ) -> Result<i64> {
            let conf = i64::try_from(price.conf_e8).map_err(|_| ErrorCode::PriceMathFailed)?;
            if side_is_buy {
                price
                    .price_e8
                    .checked_add(conf)
                    .ok_or(ErrorCode::PriceMathFailed)
            } else {
                price
                    .price_e8
                    .checked_sub(conf)
                    .ok_or(ErrorCode::PriceMathFailed)
            }
        }

        fn compute_slippage_bps(&self, limit_price_e8: i64, exec_price_e8: i64) -> Result<u16> {
            if limit_price_e8 <= 0 || exec_price_e8 <= 0 {
                return Err(ErrorCode::PriceMathFailed);
            }

            let limit = i128::from(limit_price_e8);
            let exec = i128::from(exec_price_e8);
            let diff = if exec >= limit {
                exec - limit
            } else {
                limit - exec
            };

            let bps = diff
                .checked_mul(10_000)
                .ok_or(ErrorCode::PriceMathFailed)?
                .checked_div(limit)
                .ok_or(ErrorCode::PriceMathFailed)?;

            u16::try_from(bps).map_err(|_| ErrorCode::PriceMathFailed)
        }

        fn scale_to_e8(&self, value: i64, expo: i32) -> Result<i64> {
            let shift = expo.checked_add(8).ok_or(ErrorCode::PriceMathFailed)?;
            if shift >= 0 {
                let mul = self.pow10_u64(shift as u32)?;
                let out = i128::from(value)
                    .checked_mul(i128::from(mul))
                    .ok_or(ErrorCode::PriceMathFailed)?;
                i64::try_from(out).map_err(|_| ErrorCode::PriceMathFailed)
            } else {
                let div = self.pow10_u64((-shift) as u32)?;
                let div_i64 = i64::try_from(div).map_err(|_| ErrorCode::PriceMathFailed)?;
                Ok(value / div_i64)
            }
        }

        fn scale_to_e8_u64(&self, value: u64, expo: i32) -> Result<u64> {
            let shift = expo.checked_add(8).ok_or(ErrorCode::PriceMathFailed)?;
            if shift >= 0 {
                let mul = self.pow10_u64(shift as u32)?;
                value.checked_mul(mul).ok_or(ErrorCode::PriceMathFailed)
            } else {
                let div = self.pow10_u64((-shift) as u32)?;
                Ok(value / div)
            }
        }

        fn pow10_u64(&self, n: u32) -> Result<u64> {
            let mut out = 1u64;
            for _ in 0..n {
                out = out.checked_mul(10).ok_or(ErrorCode::PriceMathFailed)?;
            }
            Ok(out)
        }
    }
}
