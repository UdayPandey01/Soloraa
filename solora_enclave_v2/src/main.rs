use std::env;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use solora_enclave_v2::attestation::Unattested;
use solora_enclave_v2::enclave_key::{EnclaveKey, FileKeyStorage};
use solora_enclave_v2::pyth::HermesHttpClient;
use solora_enclave_v2::routes::router;
use solora_enclave_v2::solana_rpc::HttpSolanaRpc;
use solora_enclave_v2::state::AppState;
use solora_enclave_v2::wormhole::GuardianSet;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let bind_addr: SocketAddr = env::var("SOLORA_ENCLAVE_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .context("SOLORA_ENCLAVE_BIND must be host:port")?;

    let key_path = env::var("SOLORA_ENCLAVE_KEY_PATH")
        .unwrap_or_else(|_| "/var/lib/solora/enclave.key".to_string());

    let solana_rpc = env::var("SOLORA_SOLANA_RPC")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
    let hermes_url =
        env::var("SOLORA_HERMES_URL").unwrap_or_else(|_| "https://hermes.pyth.network".to_string());
    let program_id_b58 = env::var("SOLORA_PROGRAM_ID")
        .unwrap_or_else(|_| "DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf".to_string());
    let program_id = decode_program_id(&program_id_b58)?;

    let storage = FileKeyStorage::new(&key_path);
    let key = Arc::new(EnclaveKey::load_or_generate(&storage)?);
    info!(
        pubkey = %bs58::encode(key.pubkey_bytes()).into_string(),
        "enclave key ready"
    );
    warn!(
        path = %key_path,
        "FileKeyStorage in use — production deployments MUST swap to a sealed (NSM/Marlin) backend"
    );

    let state = AppState {
        key,
        program_id,
        rpc: Arc::new(HttpSolanaRpc::new(solana_rpc)),
        hermes: Arc::new(HermesHttpClient::new(hermes_url)),
        guardians: Arc::new(GuardianSet::mainnet_v4()),
        attestation: Arc::new(Unattested),
    };
    let app = router(Arc::new(state));

    info!(%bind_addr, "solora-enclave starting");
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn decode_program_id(s: &str) -> anyhow::Result<[u8; 32]> {
    let raw = bs58::decode(s).into_vec()?;
    if raw.len() != 32 {
        anyhow::bail!("program id must decode to 32 bytes");
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&raw);
    Ok(out)
}
