# Solora Trust Model

This document describes who Solora protects against, what it does not
protect against, and the assumptions that the protections rest on. It is
intended to be read alongside the source: every claim here corresponds to
a verifiable check in `programs/solora/src/verify.rs`,
`programs/solora/src/attest.rs`, the Anchor accounts in
`programs/solora/src/lib.rs`, and the verification pipeline in
`solora_enclave_v2/src/`.

## System summary

A Solora wallet is a program-derived account (`SoloraWallet`) keyed by
`["solora", authority]`. It holds funds. It will only release funds when
the same transaction includes an `Ed25519Program` instruction whose
signed message is the canonical 169-byte `SOLORA_INTENT_V2` blob, and
whose signing key matches `wallet.enclave_signer`. The signing key is
held inside a Trusted Execution Environment (AWS Nitro Enclave or Marlin
Oyster CVM) running an attested binary. The signing key is rotated only
through `register_enclave_v2`, which requires the wallet authority's
signature plus a governor-signed proof referencing an active measurement
in the on-chain `MeasurementRegistry`.

## Adversaries

We model five adversaries. For each one, the document describes what the
adversary can do, what defense applies, and what residual risk remains.

### 1. Compromised AI agent

A malicious or jailbroken model that is producing intent payloads for the
relayer.

What they can do:

- Submit unlimited intent requests to the enclave.
- Pick destinations, amounts, target programs, account flags, instruction
  data — anything an honest AI could choose.

What they cannot do:

- Forge the enclave's signature. The signing key never leaves the TEE.
- Bypass the policy. The enclave's `policy.rs` runs slippage, allowlist,
  trade size, and pause checks before signing.
- Bypass the on-chain allowlist. `Policy::contains` is checked on every
  CPI in `programs/solora/src/lib.rs:235`.
- Bypass the on-chain pause. `wallet.is_active` is checked on every
  Transfer (`programs/solora/src/lib.rs:62`) and CPI
  (`programs/solora/src/lib.rs:233`).

Defense: the enclave is the policy boundary; the on-chain program is the
re-verifier. The agent's authority is exactly the cross-section of
"what the enclave will sign" and "what the chain will accept".

### 2. Compromised relayer

The TypeScript service that builds and broadcasts transactions.

What they can do:

- Refuse service.
- Reorder, delay, or batch intents from honest agents.
- Capture a signed `Ed25519Program` instruction and try to replay it.
- Build malformed transactions (wrong account list, wrong sysvars, wrong
  ordering of the Ed25519 instruction relative to the program
  instruction).

What they cannot do:

- Forge a signature. The relayer never has the enclave's key.
- Replay a captured intent. The on-chain program rejects on
  `IntentNonceMismatch` because `nonce` is incremented inside the same
  instruction that consumes the intent
  (`programs/solora/src/lib.rs:91`, `programs/solora/src/lib.rs:257`).
- Replay an intent after the blockhash window expires. The signed message
  carries `recent_blockhash` and `blockhash_slot`, and the verifier looks
  these up by binary search inside the SlotHashes sysvar
  (`programs/solora/src/verify.rs:154`). SlotHashes retains roughly the
  last 512 slots; outside that window, lookup fails and the intent is
  rejected with `BlockhashSlotNotFound`.
- Substitute the destination, amount, target program, instruction data,
  or account flags. Each is bound into `payload_hash`
  (`programs/solora/src/lib.rs:469` for Transfer,
  `programs/solora/src/lib.rs:475` for arbitrary CPI). Tampering
  invalidates the signature.
- Substitute the program ID or wallet PDA — both are bound into the
  signed message at fixed offsets and re-checked by
  `verify_enclave_intent` against `ctx.program_id` and the wallet's PDA.
- Use the Ed25519Program instruction to verify some *other* signature
  shape. The verifier requires `count == 1` and `*_ix_idx == 0xFFFF`
  (data inline, not from a separate instruction)
  (`programs/solora/src/verify.rs:122`).

Residual risk: censorship. A relayer that refuses to broadcast cannot be
forced to. Multi-relayer deployments are the standard mitigation;
nothing about Solora prevents it.

### 3. Compromised governor

The off-chain key that signs measurement-registry attestations and
issues `SOLORA_ATTEST_V1` proofs.

What they can do:

- Add a malicious measurement to the registry.
- Sign an attestation proof binding any Ed25519 pubkey of their choosing
  to that measurement.

What they cannot do:

- Rotate `wallet.enclave_signer` on their own.
  `register_enclave_v2` is `Accounts`-shaped to take only the wallet
  PDA, the registry, and the instructions sysvar — there is no governor
  account constraint, because the verifier reads the governor's
  *signature* out of the prior instruction. But the transaction itself
  still has to be signed by someone who pays for it; in the relayer
  flow, that is the wallet authority. The user must explicitly submit
  `register-enclave-v2` to consent to the rotation.
- Rotate to an enclave whose measurement is not in the on-chain registry
  *as `Active`*. `programs/solora/src/lib.rs:425` requires the
  measurement to be present and `entry.is_active()`.
- Issue a usable attestation proof for a different program or a
  different wallet — both `program_id` and `wallet_pda` are bound into
  the signed message and checked at
  `programs/solora/src/attest.rs:84` and `programs/solora/src/attest.rs:91`.
- Replay an old attestation. `wallet_nonce` is bound into the proof and
  matched against on-chain state
  (`programs/solora/src/attest.rs:110`).
- Issue a stale attestation. `expiry_slot` is checked against the
  current slot (`programs/solora/src/attest.rs:108`).

Residual risk: the governor can collude with a compromised authority.
Because both are required, this is a 2-of-2 trust assumption today and
the most important mitigation is the multisig path described under
"Future work".

### 4. Compromised authority

The user's own keypair (the keypair that paid for `initialize_wallet`).

What they can do:

- Pause the wallet, update policy, manage the allowlist, initiate the
  24-hour timelock, execute the escape hatch — these are all
  intentionally available to the authority and are the user's recovery
  surface.
- Co-sign a rotation to an arbitrary enclave (subject to the registry
  constraint).

What they cannot do without the governor:

- Rotate to an enclave whose measurement is not in the registry. The
  `register_enclave_v2` flow requires a governor-signed
  `SOLORA_ATTEST_V1` proof, so the authority alone cannot install a
  signer.
- Bypass the enclave entirely. Transfers and CPIs require an
  Ed25519-signed intent from `wallet.enclave_signer`; the authority has
  no special path that signs intents.

Residual risk: a compromised authority can pause the wallet and run out
the timelock to drain via `execute_escape`. This is by design — the
wallet must have a human-controlled exit. If the user wants to remove
this, the design space is to require a multisig authority or to remove
the escape hatch in favor of a timelock-locked governor co-signed
recovery.

### 5. Fork attacks and stale-state attacks

A network adversary that controls block production, can present
forked state to nodes, or can reorder transactions across forks.

What they can do:

- Cause a transaction to land on a fork that does not survive.

What they cannot do:

- Get a stale intent accepted on a different fork. The signed message
  binds a specific `recent_blockhash` and `blockhash_slot`. A fork
  whose SlotHashes does not contain that pair causes
  `BlockhashSlotNotFound`. A fork whose SlotHashes contains a different
  hash for that slot causes `BlockhashMismatch`
  (`programs/solora/src/verify.rs:96`).
- Replay an intent across forks. Even if the intent is valid on both
  forks, the nonce-incrementing instruction lands on at most one
  fork; the other replay is stale.

Residual risk: the user is responsible for transaction confirmation
semantics. If the user reads `processed` instead of `confirmed`, they
may see a transaction that later forks away. This is a Solana property,
not a Solora property.

## What is NOT protected

Solora explicitly does not protect against the following.

### Joint compromise of authority + governor

These two roles together can install an arbitrary enclave signer and
move funds. This is the central trust assumption of the system today
and the focus of the multisig governor and multi-enclave quorum work
described below.

### Faulty oracles upstream of Pyth

The enclave verifies Wormhole guardian signatures and Pyth merkle
proofs cryptographically — see `solora_enclave_v2/src/wormhole.rs` and
`solora_enclave_v2/src/pyth.rs`. It does not verify that Pyth's
publishers are themselves honest. If 2/3 of Wormhole guardians collude,
or if Pyth publishers report false prices, the enclave will sign an
intent against a corrupt price. This is the trust assumption inherited
by every Pyth consumer.

### Side-channel leakage from the TEE itself

AWS Nitro and Marlin Oyster have published threat models. Solora
inherits them. A novel TEE-breaking exploit that extracts the sealed
Ed25519 key would let the attacker sign intents until the measurement
is revoked. This is the reason the registry has a revocation primitive
(`revoke_measurement`).

### Denial of service

A determined adversary can refuse to relay, refuse to attest, refuse to
serve oracle data, or pause production. None of these let the adversary
move funds — the wallet stays sealed — but they can stop the user from
acting. Multi-relayer, multi-attester, and multi-oracle deployments are
the operational answer.

### Misconfigured allowlists

`add_allowed_program` is gated on the wallet authority. A user who adds
a malicious or buggy CPI target to the allowlist has expanded the
attack surface inside the policy boundary they themselves chose. Solora
prevents self-routing (`programs/solora/src/lib.rs:160`) and bounds
account count and instruction-data size for arbitrary CPI
(`programs/solora/src/lib.rs:217`), but it cannot reason about the
behavior of arbitrary downstream programs.

## Assumptions

The trust model rests on the following assumptions; each is addressed
in either the code or the operational deployment.

1. The Ed25519 verification implemented by `Ed25519Program` is sound,
   and Solana's instructions sysvar accurately reflects the
   transaction's instruction list. These are platform assumptions.
2. The TEE's sealed key storage is sound (Nitro NSM key derivation,
   Marlin image-hash derivation). This is a platform assumption.
3. The off-chain governor performs a complete attestation verification
   chain — COSE_Sign1 → X.509 → ECDSA-P384 → AWS Nitro root cert (or
   Marlin equivalent) → expected PCRs — before signing a
   `SOLORA_ATTEST_V1` proof. The on-chain program cannot enforce this;
   it can only verify the governor's Ed25519 signature over the parsed
   measurement hash.
4. The wallet authority and the governor are not jointly compromised.
5. The user reads transaction confirmations at `confirmed` or
   `finalized`, not `processed`.
6. SlotHashes is populated and accurate. This is a platform assumption.
7. The `MAX_MEASUREMENTS = 8` cap is sufficient for the operational
   rotation cadence. Larger caps require an account-resize migration.

## Defenses, mapped

| Threat                                       | Defense                                                                                         | Where                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Forged intent                                | Ed25519 verify of `wallet.enclave_signer` over canonical 169-byte message                        | `programs/solora/src/verify.rs:50`                     |
| Wrong-program intent                         | `program_id` bound into intent; checked vs `ctx.program_id`                                      | `programs/solora/src/verify.rs:62`                     |
| Wrong-wallet intent                          | `wallet_pda` bound into intent; checked vs PDA                                                   | `programs/solora/src/verify.rs:69`                     |
| Replay (same nonce)                          | `nonce` bound; incremented in handler                                                            | `programs/solora/src/verify.rs:78`, `lib.rs:91`        |
| Replay (after expiry)                        | `expiry_slot` checked vs `Clock::get()?.slot`                                                    | `programs/solora/src/verify.rs:83`                     |
| Replay (across blockhash window)             | `(recent_blockhash, blockhash_slot)` looked up in SlotHashes sysvar                              | `programs/solora/src/verify.rs:91`                     |
| Cross-kind confusion                         | `intent_kind` byte bound and matched                                                             | `programs/solora/src/verify.rs:101`                    |
| Tampered destination / amount                | `payload_hash` bound; recomputed on-chain                                                        | `programs/solora/src/lib.rs:469`                       |
| Tampered CPI target / data / accounts        | `payload_hash` covers target_program, sha256(ix_data), sha256(account_metas)                     | `programs/solora/src/lib.rs:475`                       |
| Self-CPI to escalate                         | `target_program != *ctx.program_id`                                                              | `programs/solora/src/lib.rs:225`                       |
| Disallowed CPI target                        | Allowlist check                                                                                  | `programs/solora/src/lib.rs:235`                       |
| Oversize CPI                                 | `MAX_CPI_REMAINING_ACCOUNTS`, `MAX_CPI_INSTRUCTION_DATA_LEN`                                     | `programs/solora/src/lib.rs:217`                       |
| Malicious enclave rotation                   | Governor-signed attestation proof; on-chain registry membership + active status                  | `programs/solora/src/attest.rs:46`, `lib.rs:425`       |
| Stale rotation                               | `expiry_slot` and `wallet_nonce` bound into attestation proof                                    | `programs/solora/src/attest.rs:108`                    |
| Authority-only rotation                      | Rotation requires the governor signature (no governor-only `register_enclave` path either)       | `programs/solora/src/attest.rs:69`                     |
| Revoked image still usable                   | Registry status check on every rotation                                                          | `programs/solora/src/lib.rs:425`                       |
| Untrusted oracle data inside enclave         | Wormhole VAA verify (secp256k1, 2/3 quorum) + Pyth merkle proof                                  | `solora_enclave_v2/src/wormhole.rs`, `pyth.rs`         |

## Future work

These are concrete next steps that strengthen the model. Each is a
known design and is straightforward to add; they are out of scope for
the current build.

- **On-chain P-384 verification.** When Solana ships a P-384 precompile,
  the governor's Ed25519 hop can be removed; the program will verify
  the AWS Nitro COSE_Sign1 chain directly. Until then, the trust split
  is documented and minimized.
- **Multisig governor.** Replace the single governor key with an N-of-M
  multisig (Squads, custom on-chain governance, or a multisig over an
  Ed25519 aggregate). This removes the "compromised governor +
  compromised authority" path as a single-attacker scenario.
- **Multi-enclave quorum signing.** Today `wallet.enclave_signer` is one
  Pubkey. Extend the on-chain verifier to require K-of-N Ed25519
  signatures from a slate of attested enclaves. This raises the cost of
  TEE compromise from "one image" to "K independent images".
- **Authority recovery via timelock-bonded governor.** A path where a
  lost authority can be recovered by a governor-initiated transition
  with a long timelock and on-chain notification, without expanding the
  steady-state trust model.
- **Real `AttestationProvider` implementations.** The trait is in place;
  the AWS Nitro NSM ioctl wrapper and the Marlin agent socket wrapper
  are straightforward to implement. The on-chain side is unchanged.
- **Attest-the-governor.** Run the governor *itself* inside a TEE with a
  published measurement, so the registry that the governor controls
  also constrains the governor's own image. This collapses the
  off-chain verification step into the same primitive that protects the
  wallet.
- **Measurement registry growth.** Replace the fixed-size
  `MeasurementRegistry` with a paginated, append-only structure to
  support long-running rotation history.
