# soloraa_frontend

Next.js 15 / React 19 / Tailwind CSS frontend for Solora. Premium dark
"infrastructure" aesthetic, mobile-first responsive, no backend required.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

`.env.local` ships pointing at Solana devnet. Use any modern Solana wallet
(Phantom, Backpack, Solflare) — wallet connect is provided by
`@solana/wallet-adapter-react`.

## What it does

- Premium landing page covering Problem → Solution → Security guarantees.
- `/agents` library + `/agent/[id]` detail with default-policy preview.
- **Live execution**: connect wallet → choose delegated amount → approve
  with a real devnet memo transaction → cinematic 7-stage pipeline → three
  more real devnet legs broadcast sequentially. Every signature surfaces
  with a Solana Explorer link.
- `/replay-demo` standalone scene demonstrating `IntentNonceMismatch · 6018`.
- `/portfolio` + `/security` + `/developers` + `/docs` content pages.
- `/api/agent/run` + `/api/replay/run` SSE routes for headless / shell-out
  modes (used by `SOLORA_FRONTEND_MODE=live`).

## Environment

| Variable                                | Default                                         | Notes                                                 |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_SOLANA_CLUSTER`            | `devnet`                                        | Drives explorer-link suffix and adapter endpoint.     |
| `NEXT_PUBLIC_SOLANA_RPC_URL`            | `https://api.devnet.solana.com`                 | Override for paid RPC (Helius/Triton).                |
| `NEXT_PUBLIC_SOLORA_PROGRAM_ID`         | `DfPL…1Ttf`                                     | Matches the deployed Solora program.                  |
| `NEXT_PUBLIC_SOLORA_DEMO_VAULT_PUBKEY`  | unset                                           | Optional; current build doesn't require it.           |
| `SOLORA_FRONTEND_MODE`                  | `mock`                                          | Server SSE mode. `live` shells out to `ops.ts`.       |
| `SOLORA_ENCLAVE_URL`                    | unset                                           | Required for live SSE proxy.                          |

## Deploy

Vercel (recommended):

```bash
vercel link
vercel env add NEXT_PUBLIC_SOLANA_CLUSTER       # devnet
vercel env add NEXT_PUBLIC_SOLANA_RPC_URL       # https://api.devnet.solana.com
vercel env add NEXT_PUBLIC_SOLORA_PROGRAM_ID    # 8tkBctMGe5CsGQ731t9di9hBjGg7rbMo4VEk8WujvTPS
vercel --prod
```

Or self-host any Node 20 server:

```bash
npm run build
npm run start
```

See [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for the full deploy runbook
including program + enclave + relayer.

## Layout

```
app/
├── layout.tsx           Root + global metadata + WalletProvider
├── page.tsx             Landing
├── agents/              Library (filterable)
├── agent/[id]/          Detail + AgentRunner
├── portfolio/           Wallet dashboard
├── replay-demo/         Standalone IntentNonceMismatch demo
├── security/            Guarantees + trust model
├── developers/          SDK overview
├── docs/                SDK reference
└── api/agent/run        SSE bridges (mock + live)
components/
├── agent-runner.tsx     Delegation modal → mock pipeline → real devnet legs
├── delegation-modal.tsx Mobile-friendly approval surface
├── pipeline-track.tsx   7-stage vertical timeline
├── event-feed.tsx       Streaming events with explorer links
└── …
lib/
├── solora.ts            Protocol constants + cluster/RPC defaults
├── agents.ts            Agent catalog + per-agent execution legs
├── devnet-tx.ts         Memo program transaction helper
└── execution-store.ts   Zustand store for run state
```

## Conventions

- **No backend secrets in the frontend.** Every variable is `NEXT_PUBLIC_*`.
- **Hydration-safe.** The dynamic execution feed only renders on the
  client; SSR snapshots are static and don't include timestamps.
- **No analytics, no third-party tracking.** Wallet activity is local.
