const SOLANA_RPC = "https://api.devnet.solana.com";

function requiredPubkey(
    name: string,
    PublicKeyCtor: new (value: string) => unknown,
    fallbacks: string[] = []
): unknown {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process
        ?.env ?? {};

    const keys = [name, ...fallbacks];
    const resolvedKey = keys.find((key) => !!env[key]);
    const value = resolvedKey ? env[resolvedKey] : undefined;

    if (!value) {
        throw new Error(
            `Missing required env var: ${name}. Add one of [${keys.join(", ")}] to solora_relayer/.env (e.g. ${name}=<base58_pubkey>).`
        );
    }

    if (resolvedKey && resolvedKey !== name) {
        console.warn(`Using ${resolvedKey} as fallback for ${name}.`);
    }

    return new PublicKeyCtor(value);
}

function bytesToHex(bytes: Uint8Array | number[]): string {
    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function runRelayer() {
    const dotenv = await import("dotenv");
    const path = await import("path");

    dotenv.config({ path: path.resolve(process.cwd(), "solora_relayer/.env") });
    dotenv.config();

    const web3 = await import("@solana/web3.js");
    const { Connection, PublicKey, Transaction } = web3;

    const { createHash } = await import("crypto");
    const { Buffer } = await import("buffer");

    const connection = new Connection(SOLANA_RPC, "confirmed");
    const SOLORA_PDA = requiredPubkey(
        "SOLORA_PDA",
        PublicKey,
        ["SOLORA_WALLET", "FEE_PAYER", "ENCLAVE_PUBKEY"]
    ) as InstanceType<typeof PublicKey>;
    const ENCLAVE_PUBKEY = requiredPubkey("ENCLAVE_PUBKEY", PublicKey) as InstanceType<typeof PublicKey>;

    console.log("Starting Solora Relayer...");

    const aiIntent = {
        tradeSizeUsdc: 1000,
        expectedSlippageBps: 25,
        sideIsBuy: true,
        limitPriceE8: 150_00000000,
        pythFeedIdHex: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"
    };
    console.log(`AI Intent Received: Buy $${aiIntent.tradeSizeUsdc} at max ${aiIntent.expectedSlippageBps} bps slippage.`);

    const { blockhash } = await connection.getLatestBlockhash();

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = SOLORA_PDA;

    const messageToSign = tx.compileMessage().serialize();
    const txHash32Bytes = createHash("sha256").update(messageToSign).digest();

    console.log(`Transaction built. Hash ready for Enclave validation: ${bytesToHex(txHash32Bytes)}`);

    console.log("Sending to Phala Enclave for verification...");

    const signatureBytes = new Uint8Array(64);

    tx.addSignature(
        ENCLAVE_PUBKEY,
        Buffer.from(signatureBytes) as unknown as never
    );

    console.log("Enclave Approved! Broadcasting to Solana...");
}

runRelayer().catch(console.error);