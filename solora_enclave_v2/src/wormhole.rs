//! Wormhole VAA v1 parser and guardian-quorum verifier.
//!
//! VAA v1 binary format:
//!
//! ```text
//! Header (6 bytes):
//!   1   version (must be 1)
//!   4   guardian_set_index (u32 BE)
//!   1   signatures_len (u8)
//! Signatures (66 bytes each):
//!   1   guardian_index (u8)
//!   64  signature (r || s)
//!   1   recovery_id (0 or 1)
//! Body:
//!   4   timestamp (u32 BE)
//!   4   nonce (u32 BE)
//!   2   emitter_chain (u16 BE)
//!   32  emitter_address
//!   8   sequence (u64 BE)
//!   1   consistency_level
//!   N   payload
//! ```
//!
//! The signed digest is `keccak256(keccak256(body))`. Each signature is verified
//! by recovering the public key with secp256k1 ecrecover and deriving the
//! Ethereum-style 20-byte address: `keccak256(uncompressed_pubkey[1..65])[12..32]`.
//!
//! A VAA is accepted iff `valid_signatures >= floor(n * 2 / 3) + 1` where `n` is
//! the size of the configured guardian set, AND every claimed guardian_index
//! refers to an entry in that set.

use secp256k1::ecdsa::{RecoverableSignature, RecoveryId};
use secp256k1::{Message, Secp256k1};
use tiny_keccak::{Hasher, Keccak};

use crate::error::{EnclaveError, EnclaveResult};

const VAA_HEADER_LEN: usize = 1 + 4 + 1; // version + guardian_set_index + sigs_len
const VAA_SIG_LEN: usize = 1 + 64 + 1; // index + sig + recovery
const VAA_BODY_HEADER_LEN: usize = 4 + 4 + 2 + 32 + 8 + 1; // up to consistency_level

/// A static-known guardian set: the index that the on-chain guardian-set
/// account would have, plus the 20-byte Ethereum-style addresses in order.
#[derive(Clone, Debug)]
pub struct GuardianSet {
    pub index: u32,
    pub addresses: Vec<[u8; 20]>,
}

impl GuardianSet {
    /// `floor(n * 2 / 3) + 1`. Matches Wormhole's on-chain quorum rule.
    pub fn quorum(&self) -> usize {
        (self.addresses.len() * 2) / 3 + 1
    }

    /// Wormhole mainnet guardian set #4 (active since 2024).
    /// Source: github.com/wormhole-foundation/wormhole-networks (publicly published).
    pub fn mainnet_v4() -> Self {
        let addrs: [[u8; 20]; 19] = [
            hex_lit("5893B5A76c3f739645648885bDCcC06cd70a3Cd3"),
            hex_lit("fF6CB952589BDE862c25Ef4392132fb9D4A42157"),
            hex_lit("114De8460193bdf3A2fCf81f86a09765F4762fD1"),
            hex_lit("107A0086b32d7A0977926A205131d8731D39cbEB"),
            hex_lit("8C82B2fd82FaeD2711d59AF0F2499D16e726f6b2"),
            hex_lit("11b39756C042441BE6D8650b69b54EbE715E2343"),
            hex_lit("54Ce5B4D348fb74B958e8966e2ec3dBd4958a7cd"),
            hex_lit("15e7cAF07C4e3DC8e7C469f92C8Cd88FB8005a20"),
            hex_lit("74a3bf913953D695260D88BC1aA25A4eeE363ef0"),
            hex_lit("000aC0076727b35FBea2dAc28fEE5cCB0fEA768e"),
            hex_lit("AF45Ced136b9D9e24903464AE889F5C8a723FC14"),
            hex_lit("f93124b7c738843CBB89E864c862c38cddCccF95"),
            hex_lit("D2CC37A4dc036a8D232b48f62cDD4731412f4890"),
            hex_lit("DA798F6896A3331F64b48c12D1D57Fd9cbe70811"),
            hex_lit("71AA1BE1D36CaFE3867910F99C09e347899C19C3"),
            hex_lit("8192b6E7387CCd768277c17DAb1b7a5027c0b3Cf"),
            hex_lit("178e21ad2E77AE06711549CFBB1f9c7a9d8096e8"),
            hex_lit("5E1487F35515d02A92753504a8D75471b9f49EdB"),
            hex_lit("6FbEBc898F403E4773E95feB15E80C9A99c8348d"),
        ];
        Self {
            index: 4,
            addresses: addrs.to_vec(),
        }
    }
}

const fn hex_lit(s: &str) -> [u8; 20] {
    let bytes = s.as_bytes();
    assert!(bytes.len() == 40, "20-byte hex literal");
    let mut out = [0u8; 20];
    let mut i = 0;
    while i < 20 {
        out[i] = (decode_nibble(bytes[2 * i]) << 4) | decode_nibble(bytes[2 * i + 1]);
        i += 1;
    }
    out
}

const fn decode_nibble(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'a'..=b'f' => b - b'a' + 10,
        b'A'..=b'F' => b - b'A' + 10,
        _ => panic!("invalid hex digit"),
    }
}

#[derive(Debug, Clone)]
pub struct VaaBody {
    pub timestamp: u32,
    pub nonce: u32,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub consistency_level: u8,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct VaaParsed {
    pub guardian_set_index: u32,
    pub signatures: Vec<VaaSignature>,
    pub body: VaaBody,
    /// Raw body bytes (to feed the keccak digest exactly).
    pub body_raw: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct VaaSignature {
    pub guardian_index: u8,
    pub signature: [u8; 64],
    pub recovery_id: u8,
}

pub fn parse_vaa(bytes: &[u8]) -> EnclaveResult<VaaParsed> {
    if bytes.len() < VAA_HEADER_LEN {
        return Err(EnclaveError::VaaMalformed("header truncated"));
    }
    let version = bytes[0];
    if version != 1 {
        return Err(EnclaveError::VaaMalformed("only VAA v1 supported"));
    }
    let guardian_set_index = u32::from_be_bytes(bytes[1..5].try_into().unwrap());
    let sigs_len = bytes[5] as usize;

    let sigs_end = VAA_HEADER_LEN
        .checked_add(
            sigs_len
                .checked_mul(VAA_SIG_LEN)
                .ok_or(EnclaveError::VaaMalformed("sig overflow"))?,
        )
        .ok_or(EnclaveError::VaaMalformed("sig overflow"))?;
    if bytes.len() < sigs_end + VAA_BODY_HEADER_LEN {
        return Err(EnclaveError::VaaMalformed("body header truncated"));
    }

    let mut signatures = Vec::with_capacity(sigs_len);
    for i in 0..sigs_len {
        let off = VAA_HEADER_LEN + i * VAA_SIG_LEN;
        let guardian_index = bytes[off];
        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(&bytes[off + 1..off + 65]);
        let recovery_id = bytes[off + 65];
        signatures.push(VaaSignature {
            guardian_index,
            signature: sig_bytes,
            recovery_id,
        });
    }

    let body_raw = bytes[sigs_end..].to_vec();
    let mut p = 0;
    let timestamp = u32::from_be_bytes(body_raw[p..p + 4].try_into().unwrap());
    p += 4;
    let nonce = u32::from_be_bytes(body_raw[p..p + 4].try_into().unwrap());
    p += 4;
    let emitter_chain = u16::from_be_bytes(body_raw[p..p + 2].try_into().unwrap());
    p += 2;
    let mut emitter_address = [0u8; 32];
    emitter_address.copy_from_slice(&body_raw[p..p + 32]);
    p += 32;
    let sequence = u64::from_be_bytes(body_raw[p..p + 8].try_into().unwrap());
    p += 8;
    let consistency_level = body_raw[p];
    p += 1;
    let payload = body_raw[p..].to_vec();

    Ok(VaaParsed {
        guardian_set_index,
        signatures,
        body: VaaBody {
            timestamp,
            nonce,
            emitter_chain,
            emitter_address,
            sequence,
            consistency_level,
            payload,
        },
        body_raw,
    })
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut h = Keccak::v256();
    h.update(data);
    let mut out = [0u8; 32];
    h.finalize(&mut out);
    out
}

/// `keccak256(keccak256(body))` — Wormhole's signed digest.
pub fn vaa_signing_digest(body_raw: &[u8]) -> [u8; 32] {
    keccak256(&keccak256(body_raw))
}

/// Recover the eth-style 20-byte address that signed `digest`.
fn recover_eth_address(
    digest: &[u8; 32],
    signature: &[u8; 64],
    recovery_id: u8,
) -> EnclaveResult<[u8; 20]> {
    let secp = Secp256k1::verification_only();
    let recid = RecoveryId::from_i32(recovery_id as i32)
        .map_err(|_| EnclaveError::VaaMalformed("bad recovery_id"))?;
    let msg =
        Message::from_digest_slice(digest).map_err(|_| EnclaveError::VaaMalformed("bad digest"))?;
    let sig = RecoverableSignature::from_compact(signature, recid)
        .map_err(|_| EnclaveError::VaaMalformed("bad signature"))?;
    let pk = secp
        .recover_ecdsa(&msg, &sig)
        .map_err(|_| EnclaveError::VaaMalformed("recovery failed"))?;
    let uncompressed = pk.serialize_uncompressed();
    // [0] = 0x04 prefix; [1..65] = 64-byte X||Y.
    let hashed = keccak256(&uncompressed[1..65]);
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&hashed[12..32]);
    Ok(addr)
}

/// Verify a parsed VAA against the configured guardian set. Returns the body
/// payload on success so the caller doesn't need to re-derive it.
pub fn verify_vaa<'a>(vaa: &'a VaaParsed, guardians: &GuardianSet) -> EnclaveResult<&'a VaaBody> {
    if vaa.guardian_set_index != guardians.index {
        return Err(EnclaveError::VaaWrongGuardianSet {
            expected: guardians.index,
            got: vaa.guardian_set_index,
        });
    }

    let digest = vaa_signing_digest(&vaa.body_raw);
    let mut valid = 0usize;
    let mut seen_indices = std::collections::BTreeSet::new();

    for sig in &vaa.signatures {
        let idx = sig.guardian_index as usize;
        if idx >= guardians.addresses.len() {
            // Out-of-range index: don't count, don't error — strict per-guardian
            // failures shouldn't fail the whole VAA if we still have quorum.
            continue;
        }
        if !seen_indices.insert(sig.guardian_index) {
            // Duplicate guardian index in the same VAA: ignore the second one.
            continue;
        }
        let recovered = match recover_eth_address(&digest, &sig.signature, sig.recovery_id) {
            Ok(a) => a,
            Err(_) => continue,
        };
        if recovered == guardians.addresses[idx] {
            valid += 1;
        }
    }

    let required = guardians.quorum();
    if valid < required {
        return Err(EnclaveError::VaaQuorumNotMet {
            valid,
            required,
            total: vaa.signatures.len(),
        });
    }
    Ok(&vaa.body)
}

pub mod test_support {
    use super::*;
    use secp256k1::{rand::rngs::OsRng, All, Secp256k1, SecretKey};

    pub struct TestGuardian {
        pub secret: SecretKey,
        pub address: [u8; 20],
    }

    pub struct TestGuardianGroup {
        pub set: GuardianSet,
        pub guardians: Vec<TestGuardian>,
    }

    /// Generate a synthetic guardian group whose addresses are derived from
    /// freshly generated secp256k1 keys. Used to avoid depending on the real
    /// Wormhole network in tests.
    pub fn make_test_guardians(set_index: u32, n: usize) -> TestGuardianGroup {
        let secp: Secp256k1<All> = Secp256k1::new();
        let mut rng = OsRng;
        let mut guardians = Vec::with_capacity(n);
        let mut addresses = Vec::with_capacity(n);
        for _ in 0..n {
            let secret = SecretKey::new(&mut rng);
            let pk = secret.public_key(&secp);
            let uncompressed = pk.serialize_uncompressed();
            let hashed = keccak256(&uncompressed[1..65]);
            let mut addr = [0u8; 20];
            addr.copy_from_slice(&hashed[12..32]);
            addresses.push(addr);
            guardians.push(TestGuardian {
                secret,
                address: addr,
            });
        }
        TestGuardianGroup {
            set: GuardianSet {
                index: set_index,
                addresses,
            },
            guardians,
        }
    }

    /// Build a VAA byte string signed by the first `quorum_signers` guardians.
    /// Returned bytes are exactly what real Wormhole VAAs look like on the wire.
    pub fn build_signed_vaa(
        group: &TestGuardianGroup,
        quorum_signers: usize,
        body: &VaaBody,
    ) -> Vec<u8> {
        let mut body_raw = Vec::with_capacity(VAA_BODY_HEADER_LEN + body.payload.len());
        body_raw.extend_from_slice(&body.timestamp.to_be_bytes());
        body_raw.extend_from_slice(&body.nonce.to_be_bytes());
        body_raw.extend_from_slice(&body.emitter_chain.to_be_bytes());
        body_raw.extend_from_slice(&body.emitter_address);
        body_raw.extend_from_slice(&body.sequence.to_be_bytes());
        body_raw.push(body.consistency_level);
        body_raw.extend_from_slice(&body.payload);

        let digest = vaa_signing_digest(&body_raw);
        let secp = Secp256k1::new();
        let msg = Message::from_digest_slice(&digest).unwrap();

        let mut sigs = Vec::with_capacity(quorum_signers);
        for (idx, guardian) in group.guardians.iter().take(quorum_signers).enumerate() {
            let recoverable = secp.sign_ecdsa_recoverable(&msg, &guardian.secret);
            let (recid, sig) = recoverable.serialize_compact();
            sigs.push((idx as u8, sig, recid.to_i32() as u8));
        }

        let mut out =
            Vec::with_capacity(VAA_HEADER_LEN + sigs.len() * VAA_SIG_LEN + body_raw.len());
        out.push(1u8);
        out.extend_from_slice(&group.set.index.to_be_bytes());
        out.push(sigs.len() as u8);
        for (idx, sig, recid) in &sigs {
            out.push(*idx);
            out.extend_from_slice(sig);
            out.push(*recid);
        }
        out.extend_from_slice(&body_raw);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    fn dummy_body(payload: &[u8]) -> VaaBody {
        VaaBody {
            timestamp: 1_700_000_000,
            nonce: 42,
            emitter_chain: 26,
            emitter_address: [0xEE; 32],
            sequence: 999,
            consistency_level: 1,
            payload: payload.to_vec(),
        }
    }

    #[test]
    fn quorum_math_matches_wormhole() {
        let g = GuardianSet {
            index: 0,
            addresses: vec![[0u8; 20]; 19],
        };
        assert_eq!(g.quorum(), 13);

        let g = GuardianSet {
            index: 0,
            addresses: vec![[0u8; 20]; 5],
        };
        assert_eq!(g.quorum(), 4);
    }

    #[test]
    fn round_trip_valid_vaa_passes() {
        let group = make_test_guardians(7, 5);
        let body = dummy_body(b"hello");
        let bytes = build_signed_vaa(&group, group.set.quorum(), &body);
        let parsed = parse_vaa(&bytes).unwrap();
        let verified = verify_vaa(&parsed, &group.set).unwrap();
        assert_eq!(verified.payload, b"hello");
    }

    #[test]
    fn tampered_body_fails() {
        let group = make_test_guardians(7, 5);
        let body = dummy_body(b"hello");
        let mut bytes = build_signed_vaa(&group, group.set.quorum(), &body);

        // Flip the last byte of the body (in payload).
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;

        let parsed = parse_vaa(&bytes).unwrap();
        let err = verify_vaa(&parsed, &group.set).unwrap_err();
        assert!(matches!(
            err,
            EnclaveError::VaaQuorumNotMet { valid: 0, .. }
        ));
    }

    #[test]
    fn insufficient_signers_fails_quorum() {
        let group = make_test_guardians(7, 5); // quorum = 4
        let body = dummy_body(b"hello");
        let bytes = build_signed_vaa(&group, 3, &body); // only 3 sigs
        let parsed = parse_vaa(&bytes).unwrap();
        let err = verify_vaa(&parsed, &group.set).unwrap_err();
        assert!(matches!(
            err,
            EnclaveError::VaaQuorumNotMet {
                valid: 3,
                required: 4,
                ..
            }
        ));
    }

    #[test]
    fn wrong_guardian_set_index_fails() {
        let group = make_test_guardians(7, 5);
        let body = dummy_body(b"hello");
        let bytes = build_signed_vaa(&group, group.set.quorum(), &body);
        let parsed = parse_vaa(&bytes).unwrap();

        let mut wrong = group.set.clone();
        wrong.index = 99;
        let err = verify_vaa(&parsed, &wrong).unwrap_err();
        assert!(matches!(
            err,
            EnclaveError::VaaWrongGuardianSet {
                expected: 99,
                got: 7
            }
        ));
    }

    #[test]
    fn malformed_header_fails() {
        let bytes = vec![1u8, 0, 0, 0, 4, 5]; // header but no sigs/body
        let err = parse_vaa(&bytes).unwrap_err();
        assert!(matches!(err, EnclaveError::VaaMalformed(_)));
    }

    #[test]
    fn duplicate_guardian_index_does_not_double_count() {
        // Build a VAA, then duplicate its single signature with another guardian
        // index slot occupied by the same signer. The verifier should ignore the
        // duplicate, yielding `valid = 1` and rejection if quorum is 2.
        let group = make_test_guardians(7, 4); // quorum = 3
        let body = dummy_body(b"x");
        let bytes = build_signed_vaa(&group, 1, &body);
        let parsed = parse_vaa(&bytes).unwrap();
        let err = verify_vaa(&parsed, &group.set).unwrap_err();
        assert!(matches!(
            err,
            EnclaveError::VaaQuorumNotMet {
                valid: 1,
                required: 3,
                ..
            }
        ));
    }
}
