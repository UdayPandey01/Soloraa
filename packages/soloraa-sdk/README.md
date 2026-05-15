# @soloraaa/sdk

Cryptographic execution layer for autonomous AI agents on Solana.

Submit structured intents to an attested enclave; on-chain verification rejects
anything that doesn't match the wallet's policy. The agent (and this SDK) never
hold a private key — every signature is produced inside the TEE.

```bash
npm install @soloraaa/sdk @solana/web3.js
```

## How it works

```
your agent ──► SoloraaClient ──► enclave (TEE) ──► Solana program
                                  ┊ sealed Ed25519 key
                                  ┊ signs a 169-byte
                                  ┊ SOLORA_INTENT_V2 message
                                                          │
                              re-verifies every field on-chain
                              (nonce, expiry, blockhash, payload, allowlist)
```

The client holds no signing authority over funds. The optional
`relayerKeypair` only pays the wrapping transaction's fee.

## Quick start

```ts
import { Keypair, PublicKey } from "@solana/web3.js";
import { SoloraaClient } from "@soloraaa/sdk";

const client = new SoloraaClient({
    rpcUrl: "https://api.devnet.solana.com",
    enclaveUrl: "https://enclave.your-deployment.example",
    walletPda: new PublicKey("EccZ...BWrb"),
    relayerKeypair: Keypair.fromSecretKey(/* fee payer only */),
});

const result = await client.execute({
    action: "transfer",
    destination: "9aT...VyP",
    amount: 1_000_000n, // lamports
});

console.log(result.signature);   // confirmed devnet tx
console.log(result.walletNonce); // bumped on-chain nonce
console.log(result.bytesSigned); // 169-byte canonical message
```

## Intent types

```ts
type ExecutionIntent =
    | TransferIntent
    | SwapIntent       // Jupiter
    | LendIntent       // Kamino / MarginFi / Solend
    | ArbitraryCpiIntent;
```

Every intent is constrained by the wallet's on-chain `Policy` (max trade size,
slippage cap, allowed programs, allowed tokens). The enclave refuses to sign
anything outside those bounds; the program refuses to execute anything the
enclave didn't sign.

```ts
// Swap example
await client.execute({
    action: "swap",
    protocol: "jupiter",
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: 250_000_000n,
    constraints: { maxSlippageBps: 50 },
});
```

## Streaming execution lifecycle

```ts
for await (const event of client.stream({ runId })) {
    // stages: intent → policy → oracle → build → sign → broadcast → verify
    console.log(event.stage, event);
}
```

The seven-stage pipeline mirrors what the protocol does end-to-end:

| Stage | What happens |
|---|---|
| `intent` | Agent submits a structured action. |
| `policy` | Pause flag, trade-size cap, slippage cap, allowlist evaluated. |
| `oracle` | Pyth update fetched; Wormhole guardian quorum + merkle proof verified inside the enclave. |
| `build` | Canonical 169-byte `SOLORA_INTENT_V2` message assembled. |
| `sign` | Sealed Ed25519 key inside the TEE produces a 64-byte signature. |
| `broadcast` | Ed25519 verify ix at index 0; execute ix at index 1. |
| `verify` | On-chain program re-checks every field and bumps `wallet.nonce`. |

## Verifying an intent without broadcasting

```ts
import { SoloraaClient, SOLORA_INTENT_V2_BYTES } from "@soloraaa/sdk";

const result = await client.verifyIntent({
    message,     // 169-byte Uint8Array
    signature,   // 64-byte Ed25519 signature
    enclavePubkey: "8f...J3",
});

if (result.ok) {
    console.log(result.fields.nonce, result.fields.payloadHash);
}
```

## Error codes

The SDK throws `SoloraaExecutionError` when the on-chain program rejects a
transaction. The code maps to the program's Anchor error enum:

| Code | Name |
|---|---|
| 6017 | `EnclaveSignerMismatch` |
| 6018 | `IntentNonceMismatch` |
| 6019 | `IntentExpired` |
| 6020 | `IntentKindMismatch` |
| 6021 | `IntentPayloadMismatch` |
| 6027 | `TargetProgramNotAllowed` |
| 6033 | `BlockhashMismatch` |
| 6037 | `MeasurementRevoked` |
| 6045 | `AttestationMeasurementMismatch` |
| 6046 | `AttestationGovernorMismatch` |

Every thrown `SoloraaExecutionError` carries a `docUrl` pointing at the
matching page in the error catalogue.

```ts
import { SoloraaExecutionError } from "@soloraaa/sdk";

try {
    await client.execute(intent);
} catch (err) {
    if (err instanceof SoloraaExecutionError) {
        console.error(err.code, err.name_, err.message);
        // err.docUrl → https://docs.soloraa.dev/errors/intent-nonce-mismatch
    }
}
```

## Intent verification

`client.verifyIntent(...)` performs a **real Ed25519 signature check** using
`@noble/ed25519` — never trusts the enclave's claim of its own signature.
Useful for observing pipelines that want to validate signed bytes off the
critical path.

```ts
const result = await client.verifyIntent({
    message,     // 169-byte Uint8Array
    signature,   // 64-byte Ed25519 signature
    enclavePubkey: "8f...J3",
});

if (result.ok) {
    console.log(result.fields.nonce, result.fields.payloadHash);
}
```

## Constants

```ts
import {
    SOLORA_INTENT_V2_BYTES, // 169
    INTENT_DOMAIN,           // "SOLORA_INTENT_V2"
} from "@soloraaa/sdk";
```

These are byte-for-byte mirrored by the on-chain verifier. Changing one
changes the program.

## API surface

```ts
class SoloraaClient {
    constructor(config: SoloraaClientConfig);
    execute(intent: ExecutionIntent): Promise<ExecutionResult>;
    verifyIntent(input: VerifyIntentInput): Promise<VerifyResult>;
    stream(opts: StreamOpts): AsyncIterable<ExecutionStreamEvent>;
    readonly sysvarInstructions: PublicKey;
}
```

## License

MIT.
