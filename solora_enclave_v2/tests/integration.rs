

use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use bytemuck::{bytes_of, Zeroable};
use ed25519_dalek::{Signature, Verifier};
use serde_json::json;
use solora_enclave_v2::attestation::Unattested;
use solora_enclave_v2::enclave_key::{EnclaveKey, InMemoryKeyStorage};
use solora_enclave_v2::pyth::test_support::{
    build_accumulator_update_for_message, encode_price_feed_message, InMemoryHermes,
};
use solora_enclave_v2::pyth::PriceFeedMessage;
use solora_enclave_v2::routes::router;
use solora_enclave_v2::solana_rpc::test_support::InMemoryRpc;
use solora_enclave_v2::solana_rpc::SLOT_HASHES_SYSVAR_BASE58;
use solora_enclave_v2::solora_wallet::{
    Policy as WalletPolicy, SoloraWallet, ANCHOR_DISCRIMINATOR_LEN, SOLORA_WALLET_DISCRIMINATOR,
};
use solora_enclave_v2::state::AppState;
use solora_enclave_v2::wormhole::test_support::{make_test_guardians, TestGuardianGroup};
use tower::ServiceExt;

const PROGRAM_ID: [u8; 32] = [11u8; 32];
const WALLET_PDA: [u8; 32] = [22u8; 32];
const ENCLAVE_SIGNER_HINT: [u8; 32] = [33u8; 32];
const TARGET_PROGRAM: [u8; 32] = [44u8; 32];
const DESTINATION: [u8; 32] = [55u8; 32];
const FEED_ID: [u8; 32] = [0xAB; 32];

fn b58(bytes: &[u8; 32]) -> String {
    bs58::encode(bytes).into_string()
}

fn synth_wallet(enclave_pk: [u8; 32], allowlist: &[[u8; 32]]) -> Vec<u8> {
    let mut wallet = SoloraWallet::zeroed();
    wallet.authority = [0xAA; 32];
    wallet.enclave_signer = enclave_pk;
    wallet.is_active = 1;
    wallet.nonce = 7;
    wallet.unlock_timestamp = 0;
    wallet.policy = WalletPolicy::zeroed();
    wallet.policy.max_trade_size_usdc = 10_000;
    wallet.policy.max_slippage_bps = 50;
    for (i, p) in allowlist.iter().enumerate() {
        wallet.policy.allowed_programs[i] = *p;
    }
    wallet.policy.allowed_count = allowlist.len() as u8;

    let mut out = Vec::with_capacity(ANCHOR_DISCRIMINATOR_LEN + SoloraWallet::SIZE);
    out.extend_from_slice(&SOLORA_WALLET_DISCRIMINATOR);
    out.extend_from_slice(bytes_of(&wallet));
    out
}

fn synth_slot_hashes(slot: u64, hash: [u8; 32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + 40);
    out.extend_from_slice(&1u64.to_le_bytes());
    out.extend_from_slice(&slot.to_le_bytes());
    out.extend_from_slice(&hash);
    out
}

fn sample_price_message(price_e8: i64, conf_e8: u64) -> PriceFeedMessage {
    PriceFeedMessage {
        feed_id: FEED_ID,
        price: price_e8,
        conf: conf_e8,
        exponent: -8,
        publish_time: 1_700_000_000,
        prev_publish_time: 1_699_999_999,
        ema_price: price_e8,
        ema_conf: conf_e8,
    }
}

struct Harness {
    app: axum::Router,
    enclave_pk: [u8; 32],
    guardians: TestGuardianGroup,
    rpc: Arc<InMemoryRpc>,
    hermes: Arc<InMemoryHermes>,
}

fn build_harness(allowlist: &[[u8; 32]]) -> Harness {
    let _ = ENCLAVE_SIGNER_HINT;
    let storage = InMemoryKeyStorage::new();
    let key = Arc::new(EnclaveKey::load_or_generate(&storage).unwrap());
    let enclave_pk = key.pubkey_bytes();

    let rpc = Arc::new(InMemoryRpc::new());
    rpc.set_account(b58(&WALLET_PDA), synth_wallet(enclave_pk, allowlist));
    rpc.set_account(
        SLOT_HASHES_SYSVAR_BASE58,
        synth_slot_hashes(123, [0x99; 32]),
    );

    let hermes = Arc::new(InMemoryHermes::new());
    let guardians = make_test_guardians(7, 5);
    let state = AppState {
        key,
        program_id: PROGRAM_ID,
        rpc: rpc.clone(),
        hermes: hermes.clone(),
        guardians: Arc::new(guardians.set.clone()),
        attestation: Arc::new(Unattested),
    };
    let app = router(Arc::new(state));
    Harness {
        app,
        enclave_pk,
        guardians,
        rpc,
        hermes,
    }
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(resp.into_body(), 256 * 1024).await.unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn assert_intent_signature_valid(
    enclave_pk_b58: &str,
    message_hex: &str,
    signature_hex: &str,
    expected_enclave_pk: &[u8; 32],
) {
    let pk_bytes = bs58::decode(enclave_pk_b58).into_vec().unwrap();
    assert_eq!(pk_bytes.as_slice(), expected_enclave_pk);
    let vk = ed25519_dalek::VerifyingKey::from_bytes(expected_enclave_pk).expect("32-byte pubkey");
    let sig_bytes: [u8; 64] = hex::decode(signature_hex)
        .unwrap()
        .try_into()
        .expect("64-byte signature");
    let msg = hex::decode(message_hex).unwrap();
    assert_eq!(msg.len(), 169, "canonical V2 length");
    assert_eq!(&msg[..16], b"SOLORA_INTENT_V2");
    let sig = Signature::from_bytes(&sig_bytes);
    vk.verify(&msg, &sig).expect("signature verifies");
}

#[tokio::test]
async fn transfer_intent_roundtrip_signature_verifies() {
    let h = build_harness(&[]);
    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sign-transfer-intent")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "wallet_pda": b58(&WALLET_PDA),
                        "destination": b58(&DESTINATION),
                        "amount_lamports": 1_000_000u64,
                        "expiry_slot": 1_000u64,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_intent_signature_valid(
        v["pubkey_base58"].as_str().unwrap(),
        v["message_hex"].as_str().unwrap(),
        v["signature_hex"].as_str().unwrap(),
        &h.enclave_pk,
    );
}

#[tokio::test]
async fn transfer_rejected_when_wallet_paused() {
    let h = build_harness(&[]);

    let mut paused = SoloraWallet::zeroed();
    paused.authority = [0xAA; 32];
    paused.enclave_signer = h.enclave_pk;
    paused.is_active = 0;
    paused.nonce = 7;
    let mut bytes = Vec::with_capacity(ANCHOR_DISCRIMINATOR_LEN + SoloraWallet::SIZE);
    bytes.extend_from_slice(&SOLORA_WALLET_DISCRIMINATOR);
    bytes.extend_from_slice(bytes_of(&paused));
    h.rpc.set_account(b58(&WALLET_PDA), bytes);

    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sign-transfer-intent")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "wallet_pda": b58(&WALLET_PDA),
                        "destination": b58(&DESTINATION),
                        "amount_lamports": 1u64,
                        "expiry_slot": 100u64,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "policy_rejected");
    assert!(v["detail"].as_str().unwrap().contains("paused"));
}

fn build_trade_payload(
    feed_id_hex: &str,
    target: [u8; 32],
    side_is_buy: bool,
    trade_size: u64,
    limit_price_e8: i64,
    expected_slippage_bps: u16,
) -> serde_json::Value {
    json!({
        "wallet_pda": b58(&WALLET_PDA),
        "target_program": b58(&target),
        "instruction_data_hex": "0102030405",
        "account_metas": [
            { "pubkey": b58(&[0x77u8; 32]), "is_signer": false, "is_writable": true },
        ],
        "side_is_buy": side_is_buy,
        "trade_size_usdc": trade_size,
        "limit_price_e8": limit_price_e8,
        "expected_slippage_bps": expected_slippage_bps,
        "pyth_feed_id_hex": feed_id_hex,
        "expiry_slot": 1_000u64,
    })
}

#[tokio::test]
async fn trade_intent_passes_with_valid_oracle() {
    let h = build_harness(&[TARGET_PROGRAM]);
    let feed_hex = hex::encode(FEED_ID);

    let msg = sample_price_message(145_00_000_000, 50_000_000);
    let bytes =
        build_accumulator_update_for_message(&h.guardians, &encode_price_feed_message(&msg));
    h.hermes.set(&feed_hex, bytes);

    let payload = build_trade_payload(&feed_hex, TARGET_PROGRAM, true, 1_000, 146_00_000_000, 50);
    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sign-trade-intent")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_intent_signature_valid(
        v["pubkey_base58"].as_str().unwrap(),
        v["message_hex"].as_str().unwrap(),
        v["signature_hex"].as_str().unwrap(),
        &h.enclave_pk,
    );
}

#[tokio::test]
async fn trade_rejected_when_target_not_allowlisted() {
    let h = build_harness(&[]);
    let feed_hex = hex::encode(FEED_ID);
    let msg = sample_price_message(145_00_000_000, 50_000_000);
    let bytes =
        build_accumulator_update_for_message(&h.guardians, &encode_price_feed_message(&msg));
    h.hermes.set(&feed_hex, bytes);

    let payload = build_trade_payload(&feed_hex, TARGET_PROGRAM, true, 1_000, 146_00_000_000, 50);
    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sign-trade-intent")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "policy_rejected");
}

#[tokio::test]
async fn trade_rejected_when_trade_size_exceeds_policy() {
    let h = build_harness(&[TARGET_PROGRAM]);
    let feed_hex = hex::encode(FEED_ID);
    let msg = sample_price_message(145_00_000_000, 50_000_000);
    let bytes =
        build_accumulator_update_for_message(&h.guardians, &encode_price_feed_message(&msg));
    h.hermes.set(&feed_hex, bytes);

    let payload = build_trade_payload(&feed_hex, TARGET_PROGRAM, true, 50_000, 146_00_000_000, 50);
    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sign-trade-intent")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let v = body_json(resp).await;
    assert!(
        v["detail"].as_str().unwrap().contains("trade size"),
        "{}",
        v
    );
}

#[tokio::test]
async fn trade_rejected_on_excessive_slippage() {
    let h = build_harness(&[TARGET_PROGRAM]);
    let feed_hex = hex::encode(FEED_ID);

    let msg = sample_price_message(100_00_000_000, 0);
    let bytes =
        build_accumulator_update_for_message(&h.guardians, &encode_price_feed_message(&msg));
    h.hermes.set(&feed_hex, bytes);

    let payload = build_trade_payload(&feed_hex, TARGET_PROGRAM, true, 1_000, 90_00_000_000, 50);
    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sign-trade-intent")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "policy_rejected");
}

#[tokio::test]
async fn trade_rejected_when_vaa_tampered() {
    let h = build_harness(&[TARGET_PROGRAM]);
    let feed_hex = hex::encode(FEED_ID);
    let msg = sample_price_message(145_00_000_000, 50_000_000);
    let mut bytes =
        build_accumulator_update_for_message(&h.guardians, &encode_price_feed_message(&msg));

    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    h.hermes.set(&feed_hex, bytes);

    let payload = build_trade_payload(&feed_hex, TARGET_PROGRAM, true, 1_000, 146_00_000_000, 50);
    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sign-trade-intent")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "oracle_rejected");
}

#[tokio::test]
async fn trade_rejected_when_quorum_not_met() {
    let h = build_harness(&[TARGET_PROGRAM]);
    let feed_hex = hex::encode(FEED_ID);
    let msg = sample_price_message(145_00_000_000, 50_000_000);
    let bytes =
        build_accumulator_update_for_message(&h.guardians, &encode_price_feed_message(&msg));
    h.hermes.set(&feed_hex, bytes);


    let imposters = make_test_guardians(7, 5);
    let app = {
        let storage = InMemoryKeyStorage::new();
        let key = Arc::new(EnclaveKey::load_or_generate(&storage).unwrap());
        let pk = key.pubkey_bytes();
        let rpc = Arc::new(InMemoryRpc::new());
        rpc.set_account(b58(&WALLET_PDA), synth_wallet(pk, &[TARGET_PROGRAM]));
        rpc.set_account(
            SLOT_HASHES_SYSVAR_BASE58,
            synth_slot_hashes(123, [0x99; 32]),
        );
        let state = AppState {
            key,
            program_id: PROGRAM_ID,
            rpc,
            hermes: h.hermes.clone(),
            guardians: Arc::new(imposters.set),
            attestation: Arc::new(Unattested),
        };
        router(Arc::new(state))
    };

    let payload = build_trade_payload(&feed_hex, TARGET_PROGRAM, true, 1_000, 146_00_000_000, 50);
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sign-trade-intent")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "oracle_rejected");
}

#[tokio::test]
async fn pubkey_endpoint_matches_signing_key() {
    let h = build_harness(&[]);
    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/pubkey")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    let decoded = bs58::decode(v["pubkey_base58"].as_str().unwrap())
        .into_vec()
        .unwrap();
    assert_eq!(decoded.as_slice(), &h.enclave_pk);
}

#[tokio::test]
async fn attestation_endpoint_returns_503_on_unattested_build() {
    let h = build_harness(&[]);
    let resp = h
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/attestation")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    let v = body_json(resp).await;
    assert_eq!(v["error"], "attestation_unavailable");
}
