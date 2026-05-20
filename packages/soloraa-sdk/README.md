# @soloraaa/sdk

Cryptographic execution layer for autonomous AI agents on Solana.

Submit intents to an attested enclave; on-chain verification rejects anything
that doesn't match the wallet's policy. Your bot never holds a private key —
every signature is produced inside the TEE.

```bash
npm install @soloraaa/sdk @solana/web3.js
```

## Five-line bot

The SDK defaults to the public hosted relayer at
`https://relayer.soloraa.tech` (devnet). No keys to generate, no enclave to
deploy.

```ts
import { Keypair } from "@solana/web3.js";
import { SoloraaClient } from "@soloraaa/sdk";

const client = new SoloraaClient();

const result = await client.executeTransfer({
    destination: Keypair.generate().publicKey.toBase58(),
    amountLamports: 2_000_000,
});

console.log(result.explorerUrl);
```

Run it:

```bash
npx tsx examples/run-bot.ts
```

You'll get a real devnet transaction signed inside an enclave, verified
on-chain by program `8tkBctMGe5CsGQ731t9di9hBjGg7rbMo4VEk8WujvTPS`, with a
nonce-bound replay guard.

## How it works

```
your bot ──► SoloraaClient.executeTransfer()
                 │
                 │ HTTPS POST /execute-cycle
                 ▼
            hosted relayer
                 │
                 │ POST /sign-transfer-intent
                 ▼
            enclave (Marlin Oyster CVM in production / Docker container today)
                 │ sealed Ed25519 key inside the TEE
                 │ verifies on-chain wallet state, builds canonical 169-byte
                 │ SOLORA_INTENT_V2 message, signs it
                 ▼
            relayer assembles Ed25519Program + execute_transfer ix
                 │
                 ▼
            Solana program — re-verifies signer, nonce, blockhash, expiry,
            payload hash. Rejects on any mismatch.
                 │
                 ▼
            confirmed tx, nonce bumped, funds moved
```

The client holds no signing authority over funds. Even the relayer's keypair
is just the fee payer — the wallet PDA is owned by the on-chain program and
can only be moved by a verified enclave signature.

## Configuration

| Option | Default | What it's for |
|---|---|---|
| `relayerUrl` | `https://relayer.soloraa.tech` | Point at your own relayer for self-hosted deployments |
| `walletAuthority` | (relayer default) | Pubkey whose wallet PDA the cycles act through. Default uses the hosted relayer's demo wallet. |
| `agentId` | undefined | Free-form tag stamped on each request for log correlation |
| `fetchImpl` | global `fetch` | Inject a custom fetch (useful for retries, mocks, browser polyfills) |

```ts
// Self-hosted: your own relayer + your own wallet PDA authority
const client = new SoloraaClient({
    relayerUrl: "https://relayer.my-deployment.com",
    walletAuthority: "B4D6yHTXc5diqG1qktTSCzWAgG2nPbMMm9HaLAYYWnqb",
    agentId: "market-maker-1",
});
```

## API

### `new SoloraaClient(config?: SoloraaClientConfig)`

Construct a client. All fields are optional — the default points at the
hosted relayer.

### `client.executeTransfer(req: TransferRequest): Promise<ExecutionResult>`

Sign + submit a transfer cycle. Throws `SoloraaExecutionError` on on-chain
rejection (with `code`, `errorName`, `docUrl` set).

```ts
type TransferRequest = {
    destination: string | PublicKey;
    amountLamports: bigint | number;
    cycle?: number;
};

type ExecutionResult = {
    signature: string;
    explorerUrl: string;
    nonceBefore: string;
    cycle?: number;
};
```

> **Amount minimum.** Solana requires receiving accounts to maintain a
> rent-exempt balance (~890,880 lamports for a system account). Sending less
> than this to an *uninitialized* destination fails preflight. Either reuse a
> destination that already has SOL, or send ≥ 2,000,000 lamports.

### `client.verifyIntent(input: VerifyIntentInput): Promise<VerifyResult>`

Locally re-verify a `(message, signature, pubkey)` triple via
`@noble/ed25519`. Never trusts the enclave's word; runs entirely in the
caller's process. Useful for replay tooling, audit logs, observers.

```ts
const r = await client.verifyIntent({
    message,        // 169-byte Uint8Array
    signature,      // 64-byte Ed25519 signature
    enclavePubkey,  // base58
});
if (r.ok) console.log(r.fields.nonce, r.fields.payloadHash);
```

### `client.health()`, `client.keys()`

Lightweight diagnostics. `health()` returns `{status, programId, cluster}`.
`keys()` returns `{authority, enclavePubkey}` — the latter is the *live*
enclave signer, fetched fresh from the relayer.

## Errors

```ts
import { SoloraaExecutionError } from "@soloraaa/sdk";

try {
    await client.executeTransfer({ destination, amountLamports: 2_000_000 });
} catch (err) {
    if (err instanceof SoloraaExecutionError) {
        console.error(err.code, err.errorName, err.docUrl);
        // 6018, IntentNonceMismatch, https://docs.soloraa.dev/errors/intent-nonce-mismatch
    }
}
```

Common codes:

| Code | Name | Cause |
|---|---|---|
| 6017 | EnclaveSignerMismatch | Wallet PDA's `enclave_signer` field doesn't match the signing key — usually after redeploying the enclave |
| 6018 | IntentNonceMismatch | Out-of-order or replayed intent. Refresh and retry. |
| 6019 | IntentExpired | `expiry_slot` passed before broadcast. Network was slow; retry. |
| 6027 | TargetProgramNotAllowed | Trying to invoke a CPI target not in the wallet's allowlist. |
| 6033 | BlockhashMismatch | Blockhash referenced in the intent isn't in the slot-hashes sysvar. |

Every thrown error carries the matching `docUrl` for one-click context.

## Self-hosting the relayer + enclave

The hosted relayer is fine for demos and single-tenant trials, but for real
production you should deploy your own. See
[`PRODUCTION_CUTOVER.md`](https://github.com/UdayPandey01/Soloraa/blob/master/PRODUCTION_CUTOVER.md)
in the main repo — it walks the four phases (local end-to-end → Marlin
Oyster CVM → real Jupiter swap intents → mainnet).

## Constants

```ts
import {
    SOLORA_INTENT_V2_BYTES, // 169
    INTENT_DOMAIN,           // "SOLORA_INTENT_V2"
    INTENT_OFFSETS,          // field-by-field byte offsets
    INTENT_KIND,             // { transfer: 0, arbitraryCpi: 1 }
    DEFAULT_RELAYER_URL,     // "https://relayer.soloraa.tech"
} from "@soloraaa/sdk";
```

These are byte-for-byte mirrored by the on-chain verifier. Changing one
changes the program.

## License

MIT.
