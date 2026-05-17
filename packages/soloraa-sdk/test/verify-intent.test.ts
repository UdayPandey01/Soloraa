/**
 * Run with: npx tsx test/verify-intent.test.ts
 *
 * Generates a real Ed25519 keypair, signs a synthetic 169-byte canonical
 * message, and round-trips it through `client.verifyIntent`. Exits non-zero
 * if any assertion fails.
 */
import * as ed25519 from "@noble/ed25519";
import { SoloraaClient, INTENT_DOMAIN, SOLORA_INTENT_V2_BYTES } from "../src/index.js";

let failures = 0;
function expect(cond: boolean, label: string): void {
    if (cond) {
        console.log(`PASS  ${label}`);
    } else {
        console.log(`FAIL  ${label}`);
        failures += 1;
    }
}

function buildSyntheticMessage(): Uint8Array {
    const buf = new Uint8Array(SOLORA_INTENT_V2_BYTES);
    const enc = new TextEncoder();
    buf.set(enc.encode(INTENT_DOMAIN), 0);
    for (let i = 16; i < buf.length; i++) buf[i] = i & 0xff;
    return buf;
}

async function main(): Promise<void> {
    const client = new SoloraaClient({ relayerUrl: "https://example.com" });
    const priv = ed25519.utils.randomPrivateKey();
    const pubBytes = await ed25519.getPublicKeyAsync(priv);

    const { PublicKey } = await import("@solana/web3.js");
    const pubBase58 = new PublicKey(pubBytes).toBase58();

    const goodMsg = buildSyntheticMessage();
    const goodSig = await ed25519.signAsync(goodMsg, priv);

    {
        const r = await client.verifyIntent({
            message: goodMsg,
            signature: goodSig,
            enclavePubkey: pubBase58,
        });
        expect(r.ok === true, "valid message+sig accepted");
        if (r.ok) {
            expect(r.fields.domain === INTENT_DOMAIN, "domain field decoded");
            expect(typeof r.fields.nonce === "bigint", "nonce decoded to bigint");
        }
    }

    {
        const shortMsg = goodMsg.slice(0, 100);
        const r = await client.verifyIntent({
            message: shortMsg,
            signature: goodSig,
            enclavePubkey: pubBase58,
        });
        expect(r.ok === false && r.reason === "wrong_length", "rejects short message");
    }

    {
        const wrongDomain = new Uint8Array(goodMsg);
        wrongDomain[0] = 0;
        const r = await client.verifyIntent({
            message: wrongDomain,
            signature: goodSig,
            enclavePubkey: pubBase58,
        });
        expect(r.ok === false && r.reason === "wrong_domain", "rejects wrong domain");
    }

    {
        const tampered = new Uint8Array(goodMsg);
        tampered[80] = (tampered[80] ?? 0) ^ 0xff;
        const r = await client.verifyIntent({
            message: tampered,
            signature: goodSig,
            enclavePubkey: pubBase58,
        });
        expect(r.ok === false && r.reason === "bad_signature", "rejects tampered message");
    }

    {
        const wrongKey = await ed25519.getPublicKeyAsync(ed25519.utils.randomPrivateKey());
        const wrongBase58 = new PublicKey(wrongKey).toBase58();
        const r = await client.verifyIntent({
            message: goodMsg,
            signature: goodSig,
            enclavePubkey: wrongBase58,
        });
        expect(r.ok === false && r.reason === "bad_signature", "rejects signature from wrong key");
    }

    if (failures > 0) {
        console.error(`\n${failures} test(s) failed`);
        process.exit(1);
    }
    console.log("\nall tests passed");
}

void main().catch((e) => {
    console.error(e);
    process.exit(1);
});
