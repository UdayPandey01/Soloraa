/**
 * Minimal Solora bot. Submits a transfer cycle every 30s.
 *
 *   npm install @soloraaa/sdk @solana/web3.js
 *   npx tsx examples/run-bot.ts
 *
 * Uses the public hosted relayer at https://relayer.soloraa.tech (devnet,
 * single-tenant shared wallet — fine for exploring the architecture). To run
 * on your own deployment, pass `relayerUrl` and `walletAuthority` to the
 * constructor.
 */
import { Keypair } from "@solana/web3.js";
import { SoloraaClient, SoloraaExecutionError } from "@soloraaa/sdk";

const client = new SoloraaClient({
    agentId: "my-first-bot",
});

async function tick(cycle: number): Promise<void> {
    // Make a throwaway destination so each cycle is observably distinct.
    const destination = Keypair.generate().publicKey.toBase58();

    try {
        const result = await client.executeTransfer({
            destination,
            amountLamports: 2_000_000, // 0.002 SOL — above rent-exempt minimum
            cycle,
        });
        console.log(
            `[cycle ${cycle}] confirmed`,
            "\n  sig:     ",
            result.signature,
            "\n  explorer:",
            result.explorerUrl
        );
    } catch (err) {
        if (err instanceof SoloraaExecutionError) {
            console.error(
                `[cycle ${cycle}] on-chain rejection`,
                err.code,
                err.errorName,
                "\n ",
                err.docUrl ?? err.message
            );
        } else {
            console.error(`[cycle ${cycle}] failed`, err);
        }
    }
}

async function main(): Promise<void> {
    const health = await client.health();
    const keys = await client.keys();
    console.log("relayer:", health);
    console.log("enclave pubkey:", keys.enclavePubkey);

    let cycle = 1;
    await tick(cycle++);
    setInterval(() => void tick(cycle++), 30_000);
}

void main().catch((e) => {
    console.error(e);
    process.exit(1);
});
