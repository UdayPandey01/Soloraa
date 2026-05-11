# Solora

Autonomous AI execution infrastructure for Solana. Solora lets an AI agent
hold and move funds on Solana under a cryptographic policy that the user — not
the agent — controls. Funds live in a program-derived wallet that only accepts
Ed25519-signed intents from a TEE-attested enclave; the enclave can only be
rotated by a co-signature from the wallet's authority and a registry-gated
governor. The on-chain program is a verifier, not a trust anchor: every
constraint that protects the wallet is checked against the bytes of the signed
intent and against canonical Solana sysvars.

## Why this exists

Generative agents are about to become financial actors. Today, the only way
to give an LLM the power to execute a swap, settle a trade, or pay an invoice
is to hand it a hot key — and a hot key is an unbounded license. If the model
is jailbroken, prompt-injected, or simply wrong, the wallet drains. Existing
"agent wallets" are session keys with policy guards bolted on at the SDK
layer, which means the policy is enforced by whichever process holds the key.
That is not a security boundary; it is a code review.

Solora moves the boundary onto Solana. The agent never sees a private key.
The agent talks to a confidential-compute enclave that holds an Ed25519
signing key sealed to its image hash. The enclave runs the policy
(slippage caps, allowlist, oracle freshness, pause state, nonce). The
on-chain program re-checks every field of the signed intent and refuses to
move a lamport unless every check passes. Compromise the agent and you get
nothing; compromise the relayer and you get nothing; compromise the enclave
binary and you get rejected by the on-chain measurement registry on the next
rotation.

## Architecture

```
                           ┌──────────────────────────┐
   user / AI agent  ─────► │   Relayer  (TypeScript)  │
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
                           │   - Ed25519-signs the    │
                           │     169-byte intent      │
                           └──────────┬───────────────┘
                                      │ relayer broadcasts
                           ┌──────────▼───────────────┐
                           │   Solana program         │
                           │   - SoloraWallet PDA     │
                           │   - MeasurementRegistry  │
                           │   - verifies Ed25519 ix  │
                           │     via instructions svr │
                           │   - binds nonce + slot   │
                           │     hash + payload       │
                           │   - allowlist-gated CPI  │
                           └──────────────────────────┘
```

The relayer is untrusted: it builds the transaction shape, but the on-chain
verifier reads the Ed25519 instruction and the SlotHashes sysvar directly,
so a malicious relayer cannot forge, replay, or substitute payloads.

## Run the demo in 3 minutes

Requires Docker (or Anchor + Solana CLI + Node 20).

```bash
# from the repo root
docker compose up --build

# in another shell, watch the relayer container hit demo-local:
# - mints localnet keypairs
# - initializes registry + wallet PDA
# - signs and submits a transfer intent
# - signs and submits a CPI intent
# - replays the second intent and demonstrates rejection
```

To run without Docker:

```bash
./scripts/localnet.sh           # start a local validator
./scripts/gen_keys.sh
./scripts/gen_idl.sh
./scripts/start_enclave.sh &    # production-shaped enclave service
./scripts/demo_local.sh         # full end-to-end flow
```

For the live demo script, see [DEMO.md](./DEMO.md). For the technical-track
walkthrough, see [TECHNICAL_DEMO.md](./TECHNICAL_DEMO.md).

## Repo layout

| Path                    | What it is                                                       |
| ----------------------- | ---------------------------------------------------------------- |
| `programs/solora/`      | Anchor program. Zero-copy `SoloraWallet` and `MeasurementRegistry` PDAs. Verifies Ed25519 intents and governor attestation proofs via the instructions sysvar. Allowlist-gated CPI. |
| `solora_enclave_v2/`    | Rust + Axum enclave service. Real Wormhole VAA + Pyth merkle verification. Trait-based I/O. Distroless Dockerfile. See [solora_enclave_v2/README.md](./solora_enclave_v2/README.md). |
| `solora_relayer/`       | TypeScript relayer + governance/admin CLI (`ops.ts`). Same `EnclaveClient` interface for the mock enclave and the real HTTP enclave. |
| `scripts/`              | Bash and PowerShell wrappers: `build_all`, `localnet`, `gen_keys`, `gen_idl`, `start_enclave`, `start_relayer`, `demo_local`, `demo_devnet`, `deploy_devnet`. |
| `docker-compose.yml`    | Validator + enclave + relayer wired with healthchecks.           |
| `docs/operations.md`    | Operations runbook. Env vars, admin commands, deploy flows.      |
| `docs/trust_model.md`   | Threat model, defenses, limitations, future work.                |
| `env/`                  | `.env.example` files for compose, enclave, and relayer.          |

## How to verify

The repo is built to be inspected. Three independent test paths cover the
three trust surfaces.

```bash
# 1. On-chain verifier (LiteSVM, no validator needed): 31 tests.
cargo test -p solora --tests

# 2. Enclave service: 23 unit + 10 integration tests.
cargo test -p solora_enclave_v2

# 3. Relayer cryptographic shape (offline): 42 checks.
npx tsx solora_relayer/smoke_test.ts
```

The smoke test asserts byte-for-byte that the TypeScript-built intent message
and the Solana `Ed25519Program` instruction layout match what the on-chain
verifier expects — there is no implicit trust between the relayer and the
program.

## Where the trust model lives

The single source of truth on what protects the wallet is
[docs/trust_model.md](./docs/trust_model.md). The short version:

- A wallet's funds can only be moved by an Ed25519 signature from
  `wallet.enclave_signer` over a domain-separated 169-byte intent that binds
  `(program_id, wallet_pda, nonce, expiry_slot, recent_blockhash + slot, kind,
  payload_hash)`.
- `wallet.enclave_signer` is rotated only via `register_enclave_v2`, which
  requires the wallet authority's signature plus a governor-signed attestation
  proof referencing a measurement that is present and active in the on-chain
  `MeasurementRegistry`.
- The governor verifies AWS Nitro / Marlin Oyster attestation documents
  off-chain. The `AttestationProvider` trait is in place; the parser stub
  returns `AttestationUnavailable` until a real provider is wired in.
- Replay is closed at three layers: monotonically incrementing `nonce`,
  `expiry_slot`, and `recent_blockhash` bound to the on-chain `SlotHashes`
  sysvar (~3.5 minute validity window).

## Status

Production-ready:

- On-chain verifier, including Ed25519-via-sysvar pattern, SlotHashes binding,
  payload-bound intent kind, allowlist-gated CPI, governor-signed enclave
  rotation, and the measurement registry. 31 LiteSVM tests.
- Enclave service: real Wormhole guardian-set verification (secp256k1
  ecrecover, 2/3 quorum), real Pyth PNAU merkle proof verification, policy
  engine, sealed-key abstraction, distroless container. 33 tests.
- Relayer + admin CLI (`solora_relayer/ops.ts`): 1078 lines covering registry
  governance, wallet init, attested rotation, allowlist, transfer, CPI, replay
  demonstration, devnet bring-up. Smoke test: 42 checks.

Research / scaffolded:

- The `AttestationProvider` for AWS Nitro NSM and Marlin Oyster is a trait
  with an `Unattested` stub. Real Nitro COSE/X.509/P-384 verification is
  architecturally placed at the off-chain governor; on-chain parsing of P-384
  is impractical until Solana ships a precompile, so the registry trusts the
  governor's Ed25519 signature over the parsed measurement.
- The governor is a single key in this build. A multisig or attest-the-
  governor design is the next iteration.
- Multi-enclave quorum signing is planned; today the wallet trusts a single
  attested enclave signer at a time.

## License

MIT. See `LICENSE` once added; until then, treat this repo as
source-available for evaluation.
