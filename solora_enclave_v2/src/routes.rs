use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

use crate::error::EnclaveError;
use crate::intent::AccountMetaFlags;
use crate::policy::{
    DecisionContext, PolicyEngine, SignedIntent, TradeCpiIntentRequest, TransferIntentRequest,
};
use crate::state::SharedAppState;

pub fn router(state: SharedAppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/pubkey", get(pubkey))
        .route("/attestation", get(attestation))
        .route("/sign-transfer-intent", post(sign_transfer_intent))
        .route("/sign-trade-intent", post(sign_trade_intent))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn health() -> &'static str {
    "ok"
}

#[derive(Serialize)]
struct PubkeyResponse {
    pubkey_base58: String,
    pubkey_hex: String,
}

async fn pubkey(State(state): State<SharedAppState>) -> Json<PubkeyResponse> {
    let bytes = state.key.pubkey_bytes();
    Json(PubkeyResponse {
        pubkey_base58: bs58::encode(bytes).into_string(),
        pubkey_hex: hex::encode(bytes),
    })
}

#[derive(Serialize)]
struct AttestationResponse {
    backend: &'static str,
    raw_hex: String,
}

async fn attestation(
    State(state): State<SharedAppState>,
) -> Result<Json<AttestationResponse>, ApiError> {
    let pk = state.key.pubkey_bytes();
    let doc = state.attestation.attest(&pk).await?;
    Ok(Json(AttestationResponse {
        backend: doc.backend,
        raw_hex: hex::encode(doc.raw),
    }))
}

#[derive(Deserialize)]
struct SignTransferRequest {
    wallet_pda: String,
    destination: String,
    amount_lamports: u64,
    expiry_slot: u64,
}

#[derive(Serialize)]
struct SignedIntentResponse {
    message_hex: String,
    signature_hex: String,
    pubkey_base58: String,
}

impl From<SignedIntent> for SignedIntentResponse {
    fn from(s: SignedIntent) -> Self {
        Self {
            message_hex: hex::encode(s.message),
            signature_hex: hex::encode(s.signature),
            pubkey_base58: bs58::encode(s.pubkey).into_string(),
        }
    }
}

async fn sign_transfer_intent(
    State(state): State<SharedAppState>,
    Json(req): Json<SignTransferRequest>,
) -> Result<Json<SignedIntentResponse>, ApiError> {
    let wallet_pda_bytes = decode_b58_pubkey(&req.wallet_pda)?;
    let destination = decode_b58_pubkey(&req.destination)?;

    let engine = PolicyEngine {
        rpc: state.rpc.as_ref(),
        hermes: state.hermes.as_ref(),
        guardians: state.guardians.as_ref(),
    };

    let signed = engine
        .decide_transfer(
            TransferIntentRequest {
                ctx: DecisionContext {
                    program_id: state.program_id,
                    wallet_pda_base58: &req.wallet_pda,
                    wallet_pda_bytes,
                    expiry_slot: req.expiry_slot,
                },
                destination,
                amount_lamports: req.amount_lamports,
            },
            |msg| (state.key.sign(msg), state.key.pubkey_bytes()),
        )
        .await?;
    info!(
        event = "intent_signed",
        kind = "transfer",
        wallet_pda = %req.wallet_pda,
        destination = %req.destination,
        amount_lamports = req.amount_lamports,
        expiry_slot = req.expiry_slot
    );
    Ok(Json(signed.into()))
}

#[derive(Deserialize)]
struct SignTradeRequest {
    wallet_pda: String,
    target_program: String,
    instruction_data_hex: String,
    account_metas: Vec<AccountMetaInput>,
    side_is_buy: bool,
    trade_size_usdc: u64,
    limit_price_e8: i64,
    expected_slippage_bps: u16,
    pyth_feed_id_hex: String,
    expiry_slot: u64,
}

#[derive(Deserialize)]
struct AccountMetaInput {
    pubkey: String,
    is_signer: bool,
    is_writable: bool,
}

async fn sign_trade_intent(
    State(state): State<SharedAppState>,
    Json(req): Json<SignTradeRequest>,
) -> Result<Json<SignedIntentResponse>, ApiError> {
    let wallet_pda_bytes = decode_b58_pubkey(&req.wallet_pda)?;
    let target_program = decode_b58_pubkey(&req.target_program)?;
    let instruction_data = hex::decode(req.instruction_data_hex.trim_start_matches("0x"))
        .map_err(EnclaveError::from)?;
    let metas_owned: Vec<([u8; 32], AccountMetaFlags)> = req
        .account_metas
        .iter()
        .map(|m| {
            decode_b58_pubkey(&m.pubkey).map(|k| {
                (
                    k,
                    AccountMetaFlags {
                        is_signer: m.is_signer,
                        is_writable: m.is_writable,
                    },
                )
            })
        })
        .collect::<Result<_, _>>()?;
    let metas: Vec<(&[u8; 32], AccountMetaFlags)> =
        metas_owned.iter().map(|(k, f)| (k, *f)).collect();

    let engine = PolicyEngine {
        rpc: state.rpc.as_ref(),
        hermes: state.hermes.as_ref(),
        guardians: state.guardians.as_ref(),
    };

    let signed = engine
        .decide_trade_cpi(
            TradeCpiIntentRequest {
                ctx: DecisionContext {
                    program_id: state.program_id,
                    wallet_pda_base58: &req.wallet_pda,
                    wallet_pda_bytes,
                    expiry_slot: req.expiry_slot,
                },
                target_program,
                instruction_data: &instruction_data,
                account_metas: &metas,
                side_is_buy: req.side_is_buy,
                trade_size_usdc: req.trade_size_usdc,
                limit_price_e8: req.limit_price_e8,
                expected_slippage_bps: req.expected_slippage_bps,
                pyth_feed_id_hex: &req.pyth_feed_id_hex,
            },
            |msg| (state.key.sign(msg), state.key.pubkey_bytes()),
        )
        .await?;
    info!(
        event = "intent_signed",
        kind = "trade_cpi",
        wallet_pda = %req.wallet_pda,
        target_program = %req.target_program,
        trade_size_usdc = req.trade_size_usdc,
        limit_price_e8 = req.limit_price_e8,
        expected_slippage_bps = req.expected_slippage_bps,
        feed_id = %req.pyth_feed_id_hex
    );
    Ok(Json(signed.into()))
}

fn decode_b58_pubkey(s: &str) -> Result<[u8; 32], EnclaveError> {
    let raw = bs58::decode(s)
        .into_vec()
        .map_err(|e| EnclaveError::Base58(e.to_string()))?;
    if raw.len() != 32 {
        return Err(EnclaveError::Base58(format!(
            "expected 32-byte pubkey, got {}",
            raw.len()
        )));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&raw);
    Ok(out)
}

/// HTTP error wrapper. Maps every EnclaveError to a 4xx/5xx with a stable
/// JSON body `{"error": "<kind>", "detail": "<msg>"}`.
struct ApiError(EnclaveError);

impl From<EnclaveError> for ApiError {
    fn from(e: EnclaveError) -> Self {
        ApiError(e)
    }
}

#[derive(Serialize)]
struct ApiErrorBody {
    error: &'static str,
    detail: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, kind) = match &self.0 {
            EnclaveError::WalletPaused
            | EnclaveError::PolicyTradeSizeExceeded { .. }
            | EnclaveError::PolicySlippageExceedsPolicy { .. }
            | EnclaveError::SlippageExceedsIntent { .. }
            | EnclaveError::SlippageExceedsPolicy { .. }
            | EnclaveError::TargetNotAllowed { .. } => (StatusCode::BAD_REQUEST, "policy_rejected"),

            EnclaveError::VaaMalformed(_)
            | EnclaveError::VaaQuorumNotMet { .. }
            | EnclaveError::VaaWrongGuardianSet { .. }
            | EnclaveError::PythFeedMismatch { .. }
            | EnclaveError::PriceMath => (StatusCode::BAD_REQUEST, "oracle_rejected"),

            EnclaveError::WalletAccountTooShort(_)
            | EnclaveError::WalletAccountWrongDiscriminator
            | EnclaveError::WalletAccountAlignment => {
                (StatusCode::BAD_REQUEST, "wallet_state_invalid")
            }

            EnclaveError::Base58(_)
            | EnclaveError::Hex(_)
            | EnclaveError::Base64(_)
            | EnclaveError::IntentMsgWrongSize(_) => (StatusCode::BAD_REQUEST, "request_invalid"),

            EnclaveError::Rpc(_) | EnclaveError::RpcResponse(_) => {
                (StatusCode::BAD_GATEWAY, "rpc_error")
            }

            EnclaveError::AttestationUnavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "attestation_unavailable")
            }

            EnclaveError::Io(_) | EnclaveError::Ed25519(_) | EnclaveError::Internal(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
        };
        warn!(event = "request_rejected", kind, detail = %self.0);
        let body = ApiErrorBody {
            error: kind,
            detail: self.0.to_string(),
        };
        (status, Json(body)).into_response()
    }
}
