# Solora Operations

This repository now has a single operational entrypoint for the relayer and admin flow: `solora_relayer/ops.ts`.
The shell and PowerShell scripts in `scripts/` wrap the common paths for localnet, devnet, and demo runs.

## Components

- `programs/solora`: on-chain program.
- `solora_relayer`: transaction builder, admin CLI, and demo flows.
- `solora_enclave_v2`: HTTP enclave service that signs intents.
- `docker-compose.yml`: local topology for validator, enclave, and relayer.

## Required environment

- `SOLANA_RPC_URL`: Solana RPC endpoint.
- `SOLANA_KEYPAIR_PATH`: authority keypair used by the relayer.
- `SOLORA_GOVERNOR_KEYPAIR_PATH`: governor keypair used for registry and enclave registration.
- `SOLORA_PROGRAM_ID`: optional override for the deployed program id.
- `SOLORA_MEASUREMENT_HASH`: 32-byte hex measurement used for registry and demo flows.
- `SOLORA_ENCLAVE_URL`: HTTP endpoint for the real enclave.
- `SOLORA_ENCLAVE_PUBKEY`: expected enclave pubkey when using a remote enclave.
- `SOLORA_PYTH_FEED_ID`: feed id used by the trade demo.

The relayer also accepts `solora_relayer/.env` or a repository-level `.env` file if you want to set these locally.

## Admin commands

Run the relayer CLI from the repository root:

```bash
npx tsx solora_relayer/ops.ts <command>
```

Key commands:

- `init-registry`: create the measurement registry PDA.
- `add-measurement --pcr <hex32>`: add an approved enclave measurement.
- `revoke-measurement --pcr <hex32>`: revoke an approved measurement.
- `transfer-governor --new <pubkey>`: move registry governance.
- `init-wallet`: initialize the wallet PDA for the current authority.
- `register-enclave-v2 --measurement <hex32>`: register an enclave signer after attestation verification.
- `allowlist add <programId>` and `allowlist remove <programId>`: manage allowed CPI targets.

## Transaction demos

- `transfer <destination> [--amount <lamports>] [--replay]`
- `cpi --system-transfer --destination <pubkey> --amount <lamports> [--replay]`
- `cpi --target <program> --data <hex> [--account <pubkey:signer:writable>]...`

The `--replay` flag intentionally re-sends the same payload so the replay protection path can be observed.

## Local demo flow

1. Start a validator with `scripts/localnet.{sh,ps1}`.
2. Generate local keypairs with `scripts/gen_keys.{sh,ps1}`.
3. Generate the IDL with `scripts/gen_idl.{sh,ps1}`.
4. Start the enclave with `scripts/start_enclave.{sh,ps1}` or `docker compose up enclave`.
5. Run the relayer with `scripts/start_relayer.{sh,ps1}` or `docker compose up relayer`.
6. For an end-to-end local demo, run `scripts/demo_local.{sh,ps1}`.

## Devnet flow

1. Set `SOLANA_RPC_URL` to devnet.
2. Set `SOLORA_ENCLAVE_URL` to the enclave endpoint.
3. Set `SOLORA_PYTH_FEED_ID` to the intended feed.
4. Set `SOLANA_KEYPAIR_PATH` and `SOLORA_GOVERNOR_KEYPAIR_PATH`.
5. Use `scripts/deploy_devnet.{sh,ps1}` to deploy the program.
6. Use `scripts/demo_devnet.{sh,ps1}` to run the devnet demo.

## Notes

- The mock enclave and the HTTP enclave share the same relayer interface, so swapping environments should not require transaction-shape changes.
- The registry is measurement-gated; an enclave can only be registered if its measurement is present and active.
- The relayer logs in structured JSON so traces and metrics can be consumed by external tooling.
