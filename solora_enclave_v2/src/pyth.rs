use async_trait::async_trait;
use serde::Deserialize;
use tiny_keccak::{Hasher, Keccak};

use crate::error::{EnclaveError, EnclaveResult};
use crate::wormhole::{parse_vaa, verify_vaa, GuardianSet};

pub const PNAU_MAGIC: &[u8; 4] = b"PNAU";
pub const ACCUMULATOR_UPDATE_TYPE_WORMHOLE_MERKLE: u8 = 0;
pub const HASH_LEN: usize = 20;
pub const MESSAGE_TYPE_PRICE_FEED: u8 = 0;
pub const VAA_PAYLOAD_MAGIC: &[u8; 4] = b"AUWV";

#[derive(Debug, Clone)]
pub struct AccumulatorUpdate {
    pub vaa_bytes: Vec<u8>,
    pub updates: Vec<MerkleUpdate>,
}

#[derive(Debug, Clone)]
pub struct MerkleUpdate {
    pub message: Vec<u8>,
    pub proof: Vec<[u8; HASH_LEN]>,
}

#[derive(Debug, Clone)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct VerifiedPrice {
    pub price_e8: i64,
    pub conf_e8: u64,
    pub publish_time: i64,
}

pub fn verify_accumulator_update(
    bytes: &[u8],
    feed_id_hex: &str,
    guardians: &GuardianSet,
) -> EnclaveResult<VerifiedPrice> {
    let feed_id = decode_feed_id(feed_id_hex)?;

    let update = parse_accumulator_update(bytes)?;

    let vaa_parsed = parse_vaa(&update.vaa_bytes)?;
    let body = verify_vaa(&vaa_parsed, guardians)?;

    let merkle_root = extract_merkle_root_from_payload(&body.payload)?;

    for entry in &update.updates {
        let leaf_hash = hash_leaf(&entry.message);
        if !verify_merkle_path(leaf_hash, &entry.proof, merkle_root) {
            continue;
        }
        let msg = parse_price_feed_message(&entry.message)?;
        if msg.feed_id != feed_id {
            continue;
        }
        return Ok(scale_price(&msg)?);
    }

    Err(EnclaveError::PythFeedMismatch {
        expected: feed_id_hex.to_string(),
        got: "no matching update with valid proof".to_string(),
    })
}

fn decode_feed_id(s: &str) -> EnclaveResult<[u8; 32]> {
    let cleaned = s.trim_start_matches("0x");
    let raw = hex::decode(cleaned)?;
    if raw.len() != 32 {
        return Err(EnclaveError::Internal(format!(
            "feed_id must be 32 bytes, got {}",
            raw.len()
        )));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&raw);
    Ok(out)
}

pub fn parse_accumulator_update(bytes: &[u8]) -> EnclaveResult<AccumulatorUpdate> {
    let mut p = 0usize;
    macro_rules! need {
        ($n:expr, $msg:literal) => {
            if bytes.len() < p + $n {
                return Err(EnclaveError::VaaMalformed($msg));
            }
        };
    }

    need!(4, "missing PNAU magic");
    if &bytes[p..p + 4] != PNAU_MAGIC {
        return Err(EnclaveError::VaaMalformed("bad PNAU magic"));
    }
    p += 4;
    need!(3, "missing version/trailing fields");
    let _major = bytes[p];
    p += 1;
    let _minor = bytes[p];
    p += 1;
    let trailing = bytes[p] as usize;
    p += 1;
    need!(trailing, "trailing payload truncated");
    p += trailing;

    need!(1, "missing update_type");
    let update_type = bytes[p];
    p += 1;
    if update_type != ACCUMULATOR_UPDATE_TYPE_WORMHOLE_MERKLE {
        return Err(EnclaveError::VaaMalformed(
            "unsupported accumulator update type",
        ));
    }

    need!(2, "missing vaa size");
    let vaa_len = u16::from_be_bytes(bytes[p..p + 2].try_into().unwrap()) as usize;
    p += 2;
    need!(vaa_len, "vaa truncated");
    let vaa_bytes = bytes[p..p + vaa_len].to_vec();
    p += vaa_len;

    need!(1, "missing num_updates");
    let num_updates = bytes[p] as usize;
    p += 1;

    let mut updates = Vec::with_capacity(num_updates);
    for _ in 0..num_updates {
        need!(2, "missing message size");
        let msg_len = u16::from_be_bytes(bytes[p..p + 2].try_into().unwrap()) as usize;
        p += 2;
        need!(msg_len, "message truncated");
        let message = bytes[p..p + msg_len].to_vec();
        p += msg_len;

        need!(1, "missing num_proof");
        let num_proof = bytes[p] as usize;
        p += 1;
        let proof_bytes_len = num_proof
            .checked_mul(HASH_LEN)
            .ok_or(EnclaveError::VaaMalformed("proof overflow"))?;
        need!(proof_bytes_len, "proof truncated");
        let mut proof = Vec::with_capacity(num_proof);
        for i in 0..num_proof {
            let off = p + i * HASH_LEN;
            let mut h = [0u8; HASH_LEN];
            h.copy_from_slice(&bytes[off..off + HASH_LEN]);
            proof.push(h);
        }
        p += proof_bytes_len;

        updates.push(MerkleUpdate { message, proof });
    }

    Ok(AccumulatorUpdate { vaa_bytes, updates })
}

fn extract_merkle_root_from_payload(payload: &[u8]) -> EnclaveResult<[u8; HASH_LEN]> {

    if payload.len() < 4 + 1 + 8 + 4 + HASH_LEN {
        return Err(EnclaveError::VaaMalformed("vaa payload too short"));
    }
    if &payload[..4] != VAA_PAYLOAD_MAGIC {
        return Err(EnclaveError::VaaMalformed("bad accumulator vaa magic"));
    }
    if payload[4] != ACCUMULATOR_UPDATE_TYPE_WORMHOLE_MERKLE {
        return Err(EnclaveError::VaaMalformed("unsupported vaa payload type"));
    }
    let root_off = 4 + 1 + 8 + 4;
    let mut root = [0u8; HASH_LEN];
    root.copy_from_slice(&payload[root_off..root_off + HASH_LEN]);
    Ok(root)
}

pub fn parse_price_feed_message(msg: &[u8]) -> EnclaveResult<PriceFeedMessage> {
    if msg.is_empty() {
        return Err(EnclaveError::VaaMalformed("empty PriceFeedMessage"));
    }
    if msg[0] != MESSAGE_TYPE_PRICE_FEED {
        return Err(EnclaveError::VaaMalformed("not a PriceFeedMessage"));
    }
    let needed = 1 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8;
    if msg.len() < needed {
        return Err(EnclaveError::VaaMalformed("PriceFeedMessage truncated"));
    }
    let mut p = 1;
    let mut feed_id = [0u8; 32];
    feed_id.copy_from_slice(&msg[p..p + 32]);
    p += 32;
    let price = i64::from_be_bytes(msg[p..p + 8].try_into().unwrap());
    p += 8;
    let conf = u64::from_be_bytes(msg[p..p + 8].try_into().unwrap());
    p += 8;
    let exponent = i32::from_be_bytes(msg[p..p + 4].try_into().unwrap());
    p += 4;
    let publish_time = i64::from_be_bytes(msg[p..p + 8].try_into().unwrap());
    p += 8;
    let prev_publish_time = i64::from_be_bytes(msg[p..p + 8].try_into().unwrap());
    p += 8;
    let ema_price = i64::from_be_bytes(msg[p..p + 8].try_into().unwrap());
    p += 8;
    let ema_conf = u64::from_be_bytes(msg[p..p + 8].try_into().unwrap());

    Ok(PriceFeedMessage {
        feed_id,
        price,
        conf,
        exponent,
        publish_time,
        prev_publish_time,
        ema_price,
        ema_conf,
    })
}

pub fn hash_leaf(data: &[u8]) -> [u8; HASH_LEN] {
    let mut h = Keccak::v256();
    h.update(&[0u8]);
    h.update(data);
    let mut out = [0u8; 32];
    h.finalize(&mut out);
    let mut leaf = [0u8; HASH_LEN];
    leaf.copy_from_slice(&out[..HASH_LEN]);
    leaf
}

pub fn hash_node(a: &[u8; HASH_LEN], b: &[u8; HASH_LEN]) -> [u8; HASH_LEN] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    let mut h = Keccak::v256();
    h.update(&[1u8]);
    h.update(lo);
    h.update(hi);
    let mut out = [0u8; 32];
    h.finalize(&mut out);
    let mut node = [0u8; HASH_LEN];
    node.copy_from_slice(&out[..HASH_LEN]);
    node
}

pub fn verify_merkle_path(
    leaf: [u8; HASH_LEN],
    proof: &[[u8; HASH_LEN]],
    root: [u8; HASH_LEN],
) -> bool {
    let mut current = leaf;
    for sibling in proof {
        current = hash_node(&current, sibling);
    }
    current == root
}

fn scale_price(msg: &PriceFeedMessage) -> EnclaveResult<VerifiedPrice> {
    let shift = msg.exponent.checked_add(8).ok_or(EnclaveError::PriceMath)?;
    let (price_e8, conf_e8) = if shift >= 0 {
        let mul = pow10_u128(shift as u32)?;
        let p = (msg.price as i128)
            .checked_mul(mul as i128)
            .ok_or(EnclaveError::PriceMath)?;
        let c = (msg.conf as u128)
            .checked_mul(mul)
            .ok_or(EnclaveError::PriceMath)?;
        (
            i64::try_from(p).map_err(|_| EnclaveError::PriceMath)?,
            u64::try_from(c).map_err(|_| EnclaveError::PriceMath)?,
        )
    } else {
        let div = pow10_u128((-shift) as u32)?;
        let div_i = i128::try_from(div).map_err(|_| EnclaveError::PriceMath)?;
        let p = (msg.price as i128) / div_i;
        let c = (msg.conf as u128) / div;
        (
            i64::try_from(p).map_err(|_| EnclaveError::PriceMath)?,
            u64::try_from(c).map_err(|_| EnclaveError::PriceMath)?,
        )
    };

    Ok(VerifiedPrice {
        price_e8,
        conf_e8,
        publish_time: msg.publish_time,
    })
}

fn pow10_u128(n: u32) -> EnclaveResult<u128> {
    let mut out = 1u128;
    for _ in 0..n {
        out = out.checked_mul(10).ok_or(EnclaveError::PriceMath)?;
    }
    Ok(out)
}

#[async_trait]
pub trait PythHermesClient: Send + Sync {

    async fn fetch_latest_update(&self, feed_id_hex: &str) -> EnclaveResult<Vec<u8>>;
}

pub struct HermesHttpClient {
    client: reqwest::Client,
    base_url: String,
}

impl HermesHttpClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("rustls reqwest client"),
            base_url: base_url.into(),
        }
    }
}

#[derive(Deserialize)]
struct HermesV2Response {
    binary: HermesBinary,
}
#[derive(Deserialize)]
struct HermesBinary {
    encoding: String,
    data: Vec<String>,
}

#[async_trait]
impl PythHermesClient for HermesHttpClient {
    async fn fetch_latest_update(&self, feed_id_hex: &str) -> EnclaveResult<Vec<u8>> {
        let url = format!(
            "{}/v2/updates/price/latest?ids[]={}",
            self.base_url.trim_end_matches('/'),
            feed_id_hex
        );
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| EnclaveError::Rpc(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(EnclaveError::Rpc(format!("Hermes HTTP {}", resp.status())));
        }
        let parsed: HermesV2Response = resp
            .json()
            .await
            .map_err(|e| EnclaveError::RpcResponse(e.to_string()))?;
        if parsed.binary.encoding != "hex" {
            return Err(EnclaveError::RpcResponse(format!(
                "expected hex binary, got {}",
                parsed.binary.encoding
            )));
        }
        let first = parsed
            .binary
            .data
            .first()
            .ok_or_else(|| EnclaveError::RpcResponse("Hermes binary.data empty".into()))?;
        Ok(hex::decode(first)?)
    }
}

pub mod test_support {
    use super::*;
    use crate::wormhole::test_support::{build_signed_vaa, TestGuardianGroup};
    use crate::wormhole::VaaBody;
    use std::sync::Mutex;

    pub struct InMemoryHermes {
        pub updates: Mutex<std::collections::HashMap<String, Vec<u8>>>,
    }

    impl InMemoryHermes {
        pub fn new() -> Self {
            Self {
                updates: Mutex::new(std::collections::HashMap::new()),
            }
        }
        pub fn set(&self, feed_id_hex: &str, bytes: Vec<u8>) {
            self.updates
                .lock()
                .expect("hermes test lock")
                .insert(feed_id_hex.to_lowercase(), bytes);
        }
    }

    #[async_trait]
    impl PythHermesClient for InMemoryHermes {
        async fn fetch_latest_update(&self, feed_id_hex: &str) -> EnclaveResult<Vec<u8>> {
            self.updates
                .lock()
                .expect("hermes test lock")
                .get(&feed_id_hex.to_lowercase())
                .cloned()
                .ok_or_else(|| EnclaveError::Rpc("no canned update for that feed".into()))
        }
    }

    pub fn encode_price_feed_message(msg: &PriceFeedMessage) -> Vec<u8> {
        let mut out = Vec::with_capacity(1 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8);
        out.push(MESSAGE_TYPE_PRICE_FEED);
        out.extend_from_slice(&msg.feed_id);
        out.extend_from_slice(&msg.price.to_be_bytes());
        out.extend_from_slice(&msg.conf.to_be_bytes());
        out.extend_from_slice(&msg.exponent.to_be_bytes());
        out.extend_from_slice(&msg.publish_time.to_be_bytes());
        out.extend_from_slice(&msg.prev_publish_time.to_be_bytes());
        out.extend_from_slice(&msg.ema_price.to_be_bytes());
        out.extend_from_slice(&msg.ema_conf.to_be_bytes());
        out
    }



    pub fn build_accumulator_update_for_message(
        group: &TestGuardianGroup,
        msg_bytes: &[u8],
    ) -> Vec<u8> {
        let leaf_hash = hash_leaf(msg_bytes);
        let merkle_root = leaf_hash;

        let mut payload = Vec::with_capacity(4 + 1 + 8 + 4 + HASH_LEN);
        payload.extend_from_slice(VAA_PAYLOAD_MAGIC);
        payload.push(ACCUMULATOR_UPDATE_TYPE_WORMHOLE_MERKLE);
        payload.extend_from_slice(&0u64.to_be_bytes());
        payload.extend_from_slice(&0u32.to_be_bytes());
        payload.extend_from_slice(&merkle_root);

        let body = VaaBody {
            timestamp: 1_700_000_000,
            nonce: 0,
            emitter_chain: 26,
            emitter_address: [0xEE; 32],
            sequence: 1,
            consistency_level: 1,
            payload,
        };
        let vaa = build_signed_vaa(group, group.set.quorum(), &body);

        let mut wire = Vec::new();
        wire.extend_from_slice(PNAU_MAGIC);
        wire.push(1u8);
        wire.push(0u8);
        wire.push(0u8);
        wire.push(ACCUMULATOR_UPDATE_TYPE_WORMHOLE_MERKLE);
        wire.extend_from_slice(&(vaa.len() as u16).to_be_bytes());
        wire.extend_from_slice(&vaa);
        wire.push(1u8);
        wire.extend_from_slice(&(msg_bytes.len() as u16).to_be_bytes());
        wire.extend_from_slice(msg_bytes);
        wire.push(0u8);
        wire
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::wormhole::test_support::make_test_guardians;

    fn sample_price_feed(feed: [u8; 32]) -> PriceFeedMessage {
        PriceFeedMessage {
            feed_id: feed,
            price: 145_00_000_000,
            conf: 50_000_000,
            exponent: -8,
            publish_time: 1_700_000_000,
            prev_publish_time: 1_699_999_999,
            ema_price: 145_00_000_000,
            ema_conf: 50_000_000,
        }
    }

    #[test]
    fn end_to_end_verify_passes() {
        let group = make_test_guardians(7, 5);
        let feed = [0xAB; 32];
        let msg = sample_price_feed(feed);
        let msg_bytes = encode_price_feed_message(&msg);
        let bytes = build_accumulator_update_for_message(&group, &msg_bytes);

        let feed_hex = hex::encode(feed);
        let verified = verify_accumulator_update(&bytes, &feed_hex, &group.set).unwrap();
        assert_eq!(verified.price_e8, 145_00_000_000);
        assert_eq!(verified.conf_e8, 50_000_000);
    }

    #[test]
    fn tampered_price_breaks_merkle() {
        let group = make_test_guardians(7, 5);
        let feed = [0xAB; 32];
        let msg = sample_price_feed(feed);
        let msg_bytes = encode_price_feed_message(&msg);
        let mut bytes = build_accumulator_update_for_message(&group, &msg_bytes);


        let len = bytes.len();
        bytes[len - 10] ^= 0x01;

        let feed_hex = hex::encode(feed);
        let res = verify_accumulator_update(&bytes, &feed_hex, &group.set);
        assert!(res.is_err());
    }

    #[test]
    fn wrong_feed_id_rejected() {
        let group = make_test_guardians(7, 5);
        let feed = [0xAB; 32];
        let msg = sample_price_feed(feed);
        let msg_bytes = encode_price_feed_message(&msg);
        let bytes = build_accumulator_update_for_message(&group, &msg_bytes);

        let other_feed = [0xCD; 32];
        let res = verify_accumulator_update(&bytes, &hex::encode(other_feed), &group.set);
        assert!(matches!(res, Err(EnclaveError::PythFeedMismatch { .. })));
    }

    #[test]
    fn wrong_guardian_set_rejected() {
        let real = make_test_guardians(7, 5);
        let imposters = make_test_guardians(7, 5);
        let feed = [0xAB; 32];
        let msg = sample_price_feed(feed);
        let msg_bytes = encode_price_feed_message(&msg);
        let bytes = build_accumulator_update_for_message(&real, &msg_bytes);

        let res = verify_accumulator_update(&bytes, &hex::encode(feed), &imposters.set);
        assert!(matches!(res, Err(EnclaveError::VaaQuorumNotMet { .. })));
    }
}
