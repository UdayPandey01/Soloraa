use thiserror::Error;

#[derive(Debug, Error)]
pub enum EnclaveError {
    #[error("RPC request failed: {0}")]
    Rpc(String),

    #[error("RPC response was malformed: {0}")]
    RpcResponse(String),

    #[error("base64 decode failed: {0}")]
    Base64(#[from] base64::DecodeError),

    #[error("base58 decode failed: {0}")]
    Base58(String),

    #[error("hex decode failed: {0}")]
    Hex(#[from] hex::FromHexError),

    #[error("on-chain wallet account is too short ({0} bytes)")]
    WalletAccountTooShort(usize),

    #[error("on-chain wallet account has wrong discriminator")]
    WalletAccountWrongDiscriminator,

    #[error("on-chain wallet account fails alignment / Pod check")]
    WalletAccountAlignment,

    #[error("on-chain wallet is paused (is_active=0)")]
    WalletPaused,

    #[error("trade size {trade} exceeds policy max {max}")]
    PolicyTradeSizeExceeded { trade: u64, max: u64 },

    #[error("expected slippage {expected} bps exceeds policy max {max} bps")]
    PolicySlippageExceedsPolicy { expected: u16, max: u16 },

    #[error("computed slippage {actual} bps exceeds intent ceiling {ceiling}")]
    SlippageExceedsIntent { actual: u16, ceiling: u16 },

    #[error("computed slippage {actual} bps exceeds policy ceiling {ceiling}")]
    SlippageExceedsPolicy { actual: u16, ceiling: u16 },

    #[error("CPI target program {target} is not in the wallet's allowlist")]
    TargetNotAllowed { target: String },

    #[error("VAA is malformed: {0}")]
    VaaMalformed(&'static str),

    #[error("VAA quorum not met: {valid}/{required} valid signatures over {total}")]
    VaaQuorumNotMet {
        valid: usize,
        required: usize,
        total: usize,
    },

    #[error("VAA references guardian set {got} but enclave is configured for {expected}")]
    VaaWrongGuardianSet { expected: u32, got: u32 },

    #[error("Pyth feed id mismatch (got {got}, expected {expected})")]
    PythFeedMismatch { expected: String, got: String },

    #[error("price math overflow")]
    PriceMath,

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("ed25519 key error: {0}")]
    Ed25519(String),

    #[error("intent message has the wrong length (got {0}, expected 169)")]
    IntentMsgWrongSize(usize),

    #[error("attestation not available in current build")]
    AttestationUnavailable,

    #[error("internal: {0}")]
    Internal(String),
}

pub type EnclaveResult<T> = Result<T, EnclaveError>;
