# Solora

Cryptographic execution layer for autonomous agents on Solana. Funds live in
a program-derived wallet that only accepts Ed25519-signed intents from a
TEE-attested enclave. The on-chain program independently re-verifies every
field of each intent against canonical Solana state (nonce, expiry slot,
recent blockhash via the `SlotHashes` sysvar, kind, payload hash) before
moving a lamport.

The agent never holds a private key. The enclave's signing key is sealed to
its image hash; rotation requires a co-signature from the wallet's authority
and a governor whose measurements live in an on-chain registry.

## Features

- **On-chain verifier**, not a trust anchor. The Anchor program reads the
  Ed25519 instruction from the instructions sysvar and re-checks the signed
  message against canonical sysvars; no off-chain claim is trusted.
- **Domain-separated 169-byte intents** (`SOLORA_INTENT_V2`) bind
  `(program_id, wallet_pda, nonce, expiry_slot, recent_blockhash,
  blockhash_slot, kind, payload_hash)`.
- **Three-layer replay protection**: monotonic per-wallet nonce, explicit
  `expiry_slot`, and `recent_blockhash` checked against `SlotHashes` (≈3.5-min
  validity window).
- **Allowlist-gated CPI** — a perfectly signed intent still cannot invoke a
  program that isn't in the wallet's policy allowlist.
- **Attested enclave rotation** via `register_enclave_v2`, gated by an
  on-chain `MeasurementRegistry` of TEE PCRs.
- **Real oracle integration** in the enclave: Wormhole guardian-set
  signature verification (secp256k1 ecrecover, 2/3 quorum) and Pyth
  PNAU/Merkle proof verification.
- **Marlin Oyster** attestation backend wired and documented (see
  [Deploying to Marlin Oyster](#deploying-to-marlin-oyster)).

## Architecture

```
                       ┌──────────────────────────┐
   user / agent ─────► │   Relayer  (TypeScript)  │
                       │   - builds tx            │
                       │   - never holds funds    │
                       └──────────┬───────────────┘
                                  │ HTTPS
                       ┌──────────▼───────────────┐
                       │   Enclave  (Rust, Axum)  │
                       │   - sealed Ed25519 key   │
                       │   - Wormhole VAA verify  │
                       │   - Pyth merkle verify   │
                       │   - policy gates         │
                       │   - signs 169-byte       │
                       │     SOLORA_INTENT_V2     │
                       └──────────┬───────────────┘
                                  │ relayer broadcasts
                       ┌──────────▼───────────────┐
                       │   Solana program         │
                       │   - SoloraWallet PDA     │
                       │   - MeasurementRegistry  │
                       │   - Ed25519 ix via       │
                       │     instructions sysvar  │
                       │   - SlotHashes binding   │
                       │   - allowlist-gated CPI  │
                       └──────────────────────────┘
```

The relayer is untrusted: it shapes transactions but the on-chain verifier
reads the Ed25519 instruction and sysvars directly. A malicious relayer
cannot forge, replay, or substitute payloads.

## Repository layout

| Path | Contents |
|---|---|
| `programs/solora/` | Anchor program. Zero-copy `SoloraWallet` and `MeasurementRegistry` PDAs. Ed25519-via-sysvar verifier, allowlist-gated CPI, governor-signed enclave rotation. |
| `solora_enclave_v2/` | Rust + Axum enclave service. Trait-based I/O, distroless container. Attestation backends: `Unattested` (dev) and `MarlinOysterProvider` (production). See [`solora_enclave_v2/README.md`](./solora_enclave_v2/README.md). |
| `solora_relayer/` | TypeScript relayer + admin CLI (`ops.ts`). Shared `EnclaveClient` interface for the mock signer and the real HTTP enclave. CBOR attestation parser in `oyster_attestation.ts`. |
| `packages/soloraa-sdk/` | Published `@soloraaa/sdk` client. Wraps the enclave HTTP API and on-chain `execute_intent` flow. |
| `soloraa_frontend/` | Next.js reference UI. Connects via the Solana wallet adapter, drives an autonomous agent loop signed by a session key. |
| `scripts/` | Bash + PowerShell entry points: `localnet`, `gen_keys`, `gen_idl`, `start_enclave`, `start_relayer`, `deploy_devnet`, `deploy_oyster`. |
| `docker-compose.yml` | Validator + enclave + relayer with healthchecks. |
| `docs/operations.md` | Operational runbook — env vars, admin commands, deploy flows. |
| `docs/trust_model.md` | Threat model, defences, limitations. |
| `env/` | `.env.example` templates for compose, enclave, relayer, and Marlin Oyster. |

## Getting started

### Prerequisites

- Rust 1.83+
- Solana CLI 2.x
- Anchor 0.32
- Node 20+
- Docker (optional, for `docker compose` flows)

### Quick start (local)

```bash
docker compose up --build
```

This brings up:

- a local Solana validator,
- the Solora enclave bound on `:8080`,
- the relayer container, which runs the `demo-local` flow once on boot.

To run without Docker:

```bash
./scripts/localnet.sh         # start a local validator
./scripts/gen_keys.sh
./scripts/gen_idl.sh
./scripts/start_enclave.sh &  # production-shaped enclave service
./scripts/start_relayer.sh    # invokes ops.ts demo-local
```

The relayer mints local keypairs, initialises the measurement registry and
the wallet PDA, then signs and submits a transfer intent followed by an
arbitrary CPI intent. Replaying the second intent demonstrates the on-chain
rejection.

### Configuration

Each component has its own `.env`:

| Component | Template | Loaded by |
|---|---|---|
| Docker compose | `env/compose.env.example` | `docker-compose.yml` |
| Enclave | `env/enclave.env.example` | `solora_enclave_v2` |
| Relayer / admin CLI | `env/relayer.env.example` | `solora_relayer/ops.ts` |
| Marlin Oyster deploy | `env/oyster.env.example` | `scripts/deploy_oyster.sh` |

See [`docs/operations.md`](./docs/operations.md) for the full env reference.

## Security model

The on-chain rules for moving funds out of a `SoloraWallet`:

- A transfer is authorised only by an Ed25519 signature from
  `wallet.enclave_signer` over a domain-separated 169-byte intent binding
  `(program_id, wallet_pda, nonce, expiry_slot, recent_blockhash,
  blockhash_slot, kind, payload_hash)`.
- `wallet.enclave_signer` is rotated via `register_enclave_v2`, which
  requires the wallet authority's signature plus a governor-signed
  attestation proof. The proof references a measurement that must be present
  and active in the on-chain `MeasurementRegistry`.
- The `MeasurementRegistry` is owned by a governor key. The governor verifies
  AWS Nitro / Marlin Oyster attestation documents off-chain and signs the
  resulting `(measurement, enclave_pubkey)` tuple before submitting it.
- Replay is closed at three independent layers:
  1. monotonically incrementing `nonce` per wallet,
  2. explicit `expiry_slot`,
  3. `recent_blockhash` cross-checked against `SlotHashes` (≈3.5 min window).

The single source of truth on threats and defences is
[`docs/trust_model.md`](./docs/trust_model.md).

## Deploying to Marlin Oyster

The enclave is designed to run inside a
[Marlin Oyster CVM](https://docs.marlin.org/learn/oyster/), which provides
an AWS Nitro / Intel TDX confidential VM and a local attestation server.

```
                  ┌─────────────────────────────────────────┐
                  │  Marlin Oyster CVM (AWS Nitro / TDX)    │
                  │                                          │
   user / agent ──┼──► solora-enclave (:8080)                │
                  │       │                                  │
                  │       │  on /attestation:                │
                  │       │    fetches from localhost:1300   │
                  │       │    returns raw NSM doc           │
                  │       │                                  │
                  │   ┌───▼──── Oyster attestation server ──┐│
                  │   │  PCR0/1/2 + Solora pubkey + sig    ││
                  │   └─────────────────────────────────────┘│
                  └─────────────────────────────────────────┘
                                  │
              ┌───────────────────▼────────────────────┐
              │  Off-chain governor (ops.ts)           │
              │   1. fetch + parse attestation         │
              │   2. assertBindsPubkey + assertFresh   │
              │   3. add_measurement(PCR0)             │
              │   4. register_enclave_v2(pubkey)       │
              └───────────────────┬────────────────────┘
                                  │
                  ┌───────────────▼────────────────┐
                  │  Solana on-chain               │
                  │  MeasurementRegistry           │
                  │  + SoloraWallet.enclave_signer │
                  └────────────────────────────────┘
```

### Prerequisites

```bash
# Marlin Oyster CLI
curl -fsSL https://www.marlin.org/oyster/cli/install.sh | bash

# Funded Oyster wallet — see https://docs.marlin.org/learn/oyster/wallet-setup
```

Copy `env/oyster.env.example` to `env/oyster.env` and set `OYSTER_WALLET_KEY`
and `IMAGE_REPO`.

### Deploy

```bash
bash scripts/deploy_oyster.sh
```

The script runs four phases (each is also available as its own subcommand:
`build`, `deploy`, `attest`, `register`):

1. **build** — `docker build` + `docker push` `solora_enclave_v2`.
2. **deploy** — `oyster-cvm deploy` with ports 8080 (Solora API) and 1300
   (Oyster's attestation server) exposed. The assigned HTTPS URL is
   persisted to `.last-oyster-url`.
3. **attest** — `curl ${URL}/attestation/raw` to confirm the attestation
   endpoint is responsive.
4. **register** — `ops.ts register-oyster-enclave` fetches the CBOR
   attestation, extracts PCR0 and the enclave pubkey, calls
   `add_measurement(PCR0)` against the on-chain registry, then
   `register_enclave_v2(pubkey)` to bind the enclave to the wallet PDA.

### Runtime selection

```bash
SOLORA_ATTESTATION_BACKEND=marlin-oyster        # selects the Oyster client
SOLORA_OYSTER_ATTEST_URL=http://127.0.0.1:1300 # Oyster's local endpoint
```

When `marlin-oyster` is selected, the enclave probes the attestation server
on startup and refuses to boot if it's unreachable.

### Verification surface

| Check | Location | Status |
|---|---|---|
| Enclave pubkey matches attestation `user_data` | `oyster_attestation.ts` `assertBindsPubkey` | implemented |
| Attestation timestamp within freshness window | `oyster_attestation.ts` `assertFresh` | implemented |
| PCR0 extracted from the signed NSM payload | `oyster_attestation.ts` `parseOysterAttestation` | implemented |
| COSE-Sign1 ECDSA-P384 signature | `oyster_attestation.ts` (`TODO("COSE-Sign1 verify")`) | pending |
| AWS Nitro root certificate chain walk | same | pending |
| Governor's Ed25519 signature over the measurement | on-chain `register_enclave_v2` | implemented |

Until COSE-Sign1 verification lands, the governor trusts the bytes returned
by the attestation URL. The on-chain check (the governor's Ed25519 signature
over the measurement) remains the trust anchor; the additional COSE check
protects the governor itself from a malicious URL substitution.

## Development

### Building

```bash
# Anchor program
anchor build

# Enclave service
cargo build -p solora_enclave_v2 --release

# Relayer + SDK
(cd solora_relayer && npm install)
(cd packages/soloraa-sdk && npm install && npm run build)

# Frontend
(cd soloraa_frontend && npm install && npm run build)
```

### Testing

```bash
# On-chain verifier (LiteSVM, no validator needed)
cargo test -p solora --tests

# Enclave (unit + integration)
cargo test -p solora_enclave_v2

# Relayer cryptographic shape (offline)
npx tsx solora_relayer/smoke_test.ts
```

The smoke test asserts byte-for-byte that the TypeScript-built intent
message and the Solana `Ed25519Program` instruction layout match what the
on-chain verifier expects. There is no implicit trust between the relayer
and the program.

### IDL regeneration

```bash
./scripts/gen_idl.sh   # writes target/idl/solora.json
```

The relayer reads `target/idl/solora.json` (override with `SOLORA_IDL_PATH`).

## Project status

The on-chain program, enclave service, relayer, SDK, and frontend are
functional on Solana devnet. The Marlin Oyster attestation client and the
governor-side CBOR parser are wired end-to-end; full COSE-Sign1 signature
verification against the AWS Nitro PKI is the remaining gap before mainnet
(see [verification surface](#verification-surface) above).

Known design choices not yet implemented:

- COSE-Sign1 ECDSA-P384 verification + AWS Nitro cert-chain walk.
- Governor multisig — the current build uses a single key.
- Multi-enclave quorum signing — the wallet trusts one attested signer at
  a time.

## License

MIT. See [`LICENSE`](./LICENSE).
