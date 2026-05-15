/**
 * @soloraa/sdk
 *
 * Thin client over the Soloraa enclave HTTP API + on-chain program. The
 * library is intentionally small: it shapes intents, dispatches to the
 * enclave, and broadcasts the resulting signed message via @solana/web3.js.
 *
 * Design constraint: this package holds no signing keys. Every signature
 * comes from the attested enclave. The optional `relayerKeypair` is only
 * used to pay tx fees and sign the wrapping transaction (which carries no
 * authority over wallet funds).
 *
 * See README.md for an end-to-end example.
 */
export { SoloraaClient } from "./client.js";
export { SOLORA_INTENT_V2_BYTES, INTENT_DOMAIN } from "./constants.js";
//# sourceMappingURL=index.js.map