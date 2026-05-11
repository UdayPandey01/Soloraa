# solora_enclave_v2

Production-shaped enclave service for Solora. Replaces the `MockEnclave`
TypeScript stub at the same seam: relayer sends an intent description, the
enclave fetches on-chain state, runs policy + oracle checks, builds the
canonical `SOLORA_INTENT_V2` (169 bytes) message, and returns
`{ message, signature, pubkey }`.

The on-chain Anchor program and the relayer's transaction-shape are unchanged
from the mock-enclave era — the swap is purely on this side.

## Topology

```
                  ┌─ /sign-transfer-intent ─┐
   relayer  ───►  │                          │ ───► Solana RPC (getAccountInfo)
                  │  solora-enclave (Axum)   │ ───► Pyth Hermes
                  │                          │ ───► Wormhole guardian set #4
                  └─ /sign-trade-intent ────┘
                              │
                              ▼
                    Ed25519 sign over 169B canonical msg
```

External I/O is behind traits (`SolanaRpc`, `PythHermesClient`,
`KeyStorage`, `AttestationProvider`) so integration tests cover the real
verification logic without network flakiness.

## HTTP API

- `GET /health` → `200 ok`
- `GET /pubkey` → `{ pubkey_base58, pubkey_hex }`. The relayer uses this to
  sanity-check against `wallet.enclave_signer` before broadcasting.
- `GET /attestation` → with the default `Unattested` provider, returns `503`
  with `{"error":"attestation_unavailable"}`. Real Nitro/Marlin builds plug
  in a provider that returns the COSE/Marlin attestation document binding
  the enclave's pubkey into `user_data`.
- `POST /sign-transfer-intent` → builds + signs a Transfer V2 intent.
- `POST /sign-trade-intent` → same, but additionally verifies a Pyth Hermes
  accumulator update and runs slippage/policy checks.

Errors come back with stable shapes:
```json
{ "error": "policy_rejected" | "oracle_rejected" | "wallet_state_invalid" | "rpc_error" | "request_invalid" | "attestation_unavailable" | "internal", "detail": "..." }
```

## Verification chain (oracle path)

1. Fetch `<hermes>/v2/updates/price/latest?ids[]=<feed>` → raw PNAU bytes.
2. Parse PNAU wrapper → extract Wormhole VAA + per-feed Merkle leaves.
3. Verify VAA: per-signature `secp256k1::recover_ecdsa(keccak256(keccak256(body)))`,
   compute eth-style address `keccak256(uncompressed_pubkey[1..65])[12..32]`,
   match against the configured guardian set, require `floor(n*2/3)+1` valid.
4. Pull merkle root from the VAA payload.
5. For the requested feed: `keccak160` proof verification (sorted siblings).
6. Decode `PriceFeedMessage` and scale to E8.
7. Compute worst-case execution price and slippage; compare to policy.
8. Build canonical 169-byte message; Ed25519-sign.

No step trusts Hermes' "parsed" field — every price the enclave signs is
cryptographically tied through Wormhole guardians + Pyth merkle.

## Deployment paths

### Marlin Oyster

```bash
# Build the image — Marlin's runtime measures it.
docker build -t solora-enclave:0.1.0 .

# Run inside a Marlin CVM. /var/lib/solora must be backed by a Marlin
# persistent store; /dev/marlin-attestation is exposed by the runtime.
oyster-cvm run \
  --image solora-enclave:0.1.0 \
  --persistent-store /var/lib/solora \
  --port 8080
```

To wire a real attestation provider, implement `AttestationProvider` against
the Marlin agent socket and swap `Unattested` in `main.rs`.

### AWS Nitro Enclaves

```bash
# Build a Docker image, then convert to EIF on the parent EC2 host.
docker build -t solora-enclave:0.1.0 .
nitro-cli build-enclave \
  --docker-uri solora-enclave:0.1.0 \
  --output-file solora-enclave.eif

# Run with vsock proxy on the parent so the relayer can hit it via TCP.
nitro-cli run-enclave \
  --eif-path solora-enclave.eif \
  --memory 1024 --cpu-count 2 \
  --enclave-cid 16
vsock-proxy 8080 enclave-cid 8080  # parent → enclave
```

The Nitro `AttestationProvider` impl wraps `/dev/nsm`'s
`GetAttestationDoc` ioctl with `user_data = pubkey_bytes`. Verifiers
(on-chain or relayer-side) check the COSE Sign1 against AWS's Nitro root
certificate and the program's expected PCRs.

## Sealed key strategy

`KeyStorage` is the abstraction. In dev, `FileKeyStorage` writes the 32-byte
Ed25519 secret to `SOLORA_ENCLAVE_KEY_PATH` (defaulted to
`/var/lib/solora/enclave.key`) with `0600`. **Do not deploy this to
production.**

For production:

- **Nitro**: NSM-encrypt the secret with attestation-bound key derivation.
  Persist the ciphertext in `/var/lib/solora/`. Decryption succeeds only when
  the enclave's PCRs match the original sealing.
- **Marlin**: derive the secret from the enclave-image hash via Marlin's KMS
  primitive. Never persist; re-derive on each cold start.

Both impls satisfy the `KeyStorage` trait and slot in via a one-line change
in `main.rs`.

## Stable interface vs mock enclave

The relayer's mock-vs-real swap point is `solora_relayer/enclave_client.ts`:
both `MockEnclave` and `RealEnclave` implement the same `EnclaveClient`
shape (`pubkey()`, `signTransferIntent(...)`, `signTradeIntent(...)`). The
on-chain program is unchanged.

## Tests

```bash
cargo test -p solora_enclave_v2
```

23 unit + 10 integration tests cover:
- Canonical message byte layout (matches `programs/solora/src/state.rs`)
- Zero-copy wallet account decoding (matches the on-chain Anchor zero_copy)
- Wormhole VAA parsing + secp256k1 ecrecover + quorum
- Pyth PNAU + merkle proof verification
- Tampered-VAA, tampered-merkle, wrong-feed-id, wrong-guardian-set rejection
- Policy gates: paused wallet, oversize trade, slippage, allowlist
- HTTP error mapping (every EnclaveError ⇒ stable error code + 4xx/5xx)
- End-to-end signed-intent roundtrip with Ed25519 verify
