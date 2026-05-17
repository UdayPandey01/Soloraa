// Smoke-test the cloud relayer with one execute-cycle call.
// Usage: node cloud-smoke.js [amountLamports]
const web3 = require("@solana/web3.js");

const RELAYER = process.env.RELAYER_URL ?? "https://relayer.soloraa.tech";
const AUTHORITY = process.env.AUTHORITY_PUBKEY ?? "B4D6yHTXc5diqG1qktTSCzWAgG2nPbMMm9HaLAYYWnqb";
const AMOUNT = Number(process.argv[2] ?? "2000000");

(async () => {
    const dest = web3.Keypair.generate().publicKey.toBase58();
    const payload = { authority: AUTHORITY, destination: dest, amountLamports: AMOUNT };
    console.log("→ POST", `${RELAYER}/execute-cycle`);
    console.log("  body:", payload);

    const r = await fetch(`${RELAYER}/execute-cycle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
    const body = await r.text();
    console.log("← status:", r.status);
    try {
        const parsed = JSON.parse(body);
        console.log(JSON.stringify(parsed, null, 2));
        if (parsed.explorerUrl) console.log("\nView on devnet:\n  " + parsed.explorerUrl);
    } catch {
        console.log(body);
    }
})().catch((e) => { console.error(e); process.exit(1); });
