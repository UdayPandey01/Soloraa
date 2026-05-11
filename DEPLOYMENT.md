# Solora — Deployment Runbook

This file is the single source of truth for taking Solora from a fresh
checkout to a live, judge-ready demo. It assumes Solana devnet for the
on-chain side and either a Docker host or a managed Node/Rust host for the
off-chain services.

If a step says **"already done for the canonical devnet build"**, the
artifact at the listed address is the one referenced everywhere in the
frontend and SDK. Re-running the step changes the address and requires
updating every downstream env var.

---

## 0 · Canonical devnet addresses

| Surface             | Address / URL                                                   | Status                  |
| ------------------- | --------------------------------------------------------------- | ----------------------- |
| Solana program      | `DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf`                  | deployed (devnet)       |
| Program authority   | `J6wtumDf96ikimNx7AbTfEm8hJVazzipHw2VSjXiV92C`                  | upgrade-authority owner |
| Program data PDA    | `8rixHQRXMsusKxRUGha6ynfgbDThZMDi98PSAbKXdNgw`                  | derived                 |
| Solana cluster      | `https://api.devnet.solana.com`                                 | public RPC              |
| Memo program (demo) | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`                   | spl-memo v2             |

The frontend uses the SPL Memo program for the four real devnet
transactions it broadcasts during a run (one delegation receipt + three
agent execution legs). No fresh program deploy is required to demo.

---

## 1 · Prerequisites

```bash
solana --version         # 3.x (Agave) or 1.18+
anchor --version         # anchor-cli 1.0+
cargo --version          # rustc 1.79+ stable
node --version           # 20.x
docker --version         # optional, only for compose flow
```

The repo's `Makefile` ties together the most common targets:

```bash
make help                # list shortcuts
make verify              # build program + run every test surface
make idl                 # regenerate solora_relayer/solora.json
make localnet            # local validator with program preloaded
make demo-local          # full end-to-end against the local validator
```

---

## 2 · One-time devnet bring-up (skip if using the canonical address)

```bash
# Generate keys + authority.
./scripts/gen_keys.sh keys

# Configure CLI for devnet.
solana config set --url https://api.devnet.solana.com
solana config set --keypair keys/authority.json

# Airdrop ~3 SOL to authority + governor (devnet faucet may rate-limit).
solana airdrop 2 $(solana-keygen pubkey keys/authority.json) --url devnet
solana airdrop 2 $(solana-keygen pubkey keys/governor.json)  --url devnet

# Build + deploy.
cargo-build-sbf --manifest-path programs/solora/Cargo.toml
solana program deploy --url devnet --program-id keys/solora-program.json \
    target/deploy/solora.so

# Initialize the on-chain registry, add the enclave measurement, and
# initialize a wallet PDA bound to the authority + governor.
SOLANA_KEYPAIR_PATH=keys/authority.json \
SOLORA_GOVERNOR_KEYPAIR_PATH=keys/governor.json \
SOLANA_RPC_URL=https://api.devnet.solana.com \
SOLORA_MEASUREMENT_HASH=$(openssl rand -hex 32) \
    npx tsx solora_relayer/ops.ts init-registry
SOLANA_KEYPAIR_PATH=keys/authority.json \
SOLORA_GOVERNOR_KEYPAIR_PATH=keys/governor.json \
SOLANA_RPC_URL=https://api.devnet.solana.com \
SOLORA_MEASUREMENT_HASH=$(cat keys/measurement.hex) \
    npx tsx solora_relayer/ops.ts add-measurement
SOLANA_KEYPAIR_PATH=keys/authority.json \
SOLANA_RPC_URL=https://api.devnet.solana.com \
    npx tsx solora_relayer/ops.ts init-wallet
```

Verify the deployment landed:

```bash
solana program show DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf \
    --url devnet
```

---

## 3 · Enclave service

Two deploy targets are wired:

### 3a · Docker (any host)

```bash
cp env/enclave.env.example env/enclave.env
# Fill in SOLORA_PROGRAM_ID, SOLORA_SOLANA_RPC, SOLORA_HERMES_URL,
# SOLORA_PYTH_FEED_ID. Leave SOLORA_ENCLAVE_KEY_PATH at the default
# /var/lib/solora/enclave.key; the container persists it under a volume.

docker compose up enclave        # foreground
docker compose up -d enclave     # daemon
docker compose logs -f enclave
```

The `solora_enclave_v2/Dockerfile` is a multi-stage distroless build; the
final image is < 30 MB.

### 3b · Marlin Oyster (CVM)

```bash
# from solora_enclave_v2/
oyster-build build --image-config oyster.image.json
oyster deploy --instance-type m5.large.dev --measurement-mode keyless
```

After deploy, the public endpoint is in the Marlin dashboard.
Update `env/enclave.env` to point `SOLORA_SOLANA_RPC` at the relayer's
RPC and to publish the new measurement to the on-chain registry:

```bash
SOLORA_MEASUREMENT_HASH=<from marlin> \
    npx tsx solora_relayer/ops.ts add-measurement
```

---

## 4 · Relayer (admin CLI + worker)

The relayer is a TypeScript service driven by `solora_relayer/ops.ts`. It
is **stateless** — every flow re-reads on-chain state and the enclave
endpoint. No DB.

```bash
cp env/relayer.env.example env/relayer.env
# Set SOLANA_RPC_URL, SOLANA_KEYPAIR_PATH, SOLORA_ENCLAVE_URL,
# SOLORA_GOVERNOR_KEYPAIR_PATH (only if running governance flows),
# SOLORA_MEASUREMENT_HASH (only for register-enclave-v2 flows).

# Foreground demo:
./scripts/start_relayer.sh transfer \
    --destination <pubkey> --amount 1000000

# Or via docker compose:
docker compose up relayer
```

The relayer never holds funds. The only key it carries is the wallet
authority's, used to sign transaction shells. The on-chain verifier
ignores the wallet authority on `execute_*` instructions — those are
gated purely by the Ed25519 enclave signature.

---

## 5 · Frontend (Next.js)

### 5a · Local

```bash
cd soloraa_frontend
cp .env.example .env.local      # defaults already target devnet
npm install
npm run dev                     # http://localhost:3000
```

### 5b · Vercel (production)

The frontend is plain Next.js 15 with no server-only secrets, so any
hosting target that runs Node 20 will work. The recommended path is
Vercel because it ships with prebuilt Geist fonts + edge-friendly Image
optimization:

```bash
# Repo root.
npm install -g vercel
cd soloraa_frontend
vercel link --yes
vercel env add NEXT_PUBLIC_SOLANA_CLUSTER       # devnet
vercel env add NEXT_PUBLIC_SOLANA_RPC_URL       # https://api.devnet.solana.com
vercel env add NEXT_PUBLIC_SOLORA_PROGRAM_ID    # DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf
vercel --prod
```

That's it. The Wallet Standard auto-detects Phantom / Backpack / Solflare
in the user's browser, the delegation flow signs a memo tx, and the
agent run broadcasts three more memos sequentially with explorer links.
No server-side state, no API keys, no backend.

### 5c · Self-host

```bash
cd soloraa_frontend
npm run build                   # outputs to .next/
npm run start                   # production server on :3000
# Or behind a reverse proxy (nginx, Caddy).
```

---

## 6 · Runtime verification checklist

After every deploy:

| Check                             | How                                                              | Expected                          |
| --------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| Program is upgrade-deployable     | `solana program show <PID> --url devnet`                         | shows `Authority` you control     |
| Frontend resolves wallet adapter  | Open `/agents`, click Connect → Phantom modal                    | Wallet list appears               |
| Mock pipeline animates            | `/agent/<id>`, click Run, accept delegation                      | 7 stages flip green over ~5s      |
| Real devnet legs broadcast        | After mock pipeline                                              | 3 more sigs + Explorer links      |
| Replay attempt rejected           | Click Simulate replay attack                                     | Red pipeline + `IntentNonceMismatch · 6018` |
| Standalone replay page works      | `/replay-demo` → Sign & broadcast → Replay                       | Same rejection visual             |
| Mobile responsive                 | Resize to 360 × 640                                              | Nav collapses to hamburger        |
| Devnet RPC is reachable           | `curl -X POST -H 'Content-Type: application/json' …`             | 200 OK                            |

---

## 7 · Operational runbook

See [`docs/operations.md`](docs/operations.md) for per-command flows
(rotation, allowlist, escape hatch, pause). The runbook assumes you have
already followed sections 1–4 above.
