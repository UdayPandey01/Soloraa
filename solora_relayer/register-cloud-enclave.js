// One-off: point the existing wallet PDA at a new enclave pubkey.
// Usage:
//   node scripts/register-cloud-enclave.js <new-enclave-pubkey-base58>
const anchor = require("@coral-xyz/anchor");
const web3 = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

const NEW_ENCLAVE_B58 = process.argv[2];
if (!NEW_ENCLAVE_B58) {
    console.error("Usage: node scripts/register-cloud-enclave.js <new-enclave-pubkey-base58>");
    process.exit(1);
}
const newEnclave = new web3.PublicKey(NEW_ENCLAVE_B58);

const PROGRAM_ID = new web3.PublicKey(
    process.env.SOLORA_PROGRAM_ID ?? "8tkBctMGe5CsGQ731t9di9hBjGg7rbMo4VEk8WujvTPS"
);
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const authoritySecret = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "keys", "authority.json"), "utf8")
);
const authority = web3.Keypair.fromSecretKey(Uint8Array.from(authoritySecret));

const conn = new web3.Connection(RPC, "confirmed");
const provider = new anchor.AnchorProvider(
    conn,
    {
        publicKey: authority.publicKey,
        signTransaction: async (tx) => { tx.partialSign(authority); return tx; },
        signAllTransactions: async (txs) => { txs.forEach((t) => t.partialSign(authority)); return txs; },
    },
    { commitment: "confirmed" }
);
anchor.setProvider(provider);

const idl = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "target", "idl", "solora.json"), "utf8")
);
const program = new anchor.Program(idl, provider);

const [walletPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("solora"), authority.publicKey.toBuffer()],
    PROGRAM_ID
);

(async () => {
    console.log("authority:", authority.publicKey.toBase58());
    console.log("wallet PDA:", walletPda.toBase58());
    console.log("new enclave:", newEnclave.toBase58());

    const sig = await program.methods
        .registerEnclave(newEnclave)
        .accounts({
            soloraWallet: walletPda,
            authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

    console.log("registered, sig:", sig);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
})().catch((e) => { console.error(e); process.exit(1); });
