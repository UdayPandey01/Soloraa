async function main() {
    const dotenv = await import("dotenv");
    const path = await import("path");
    const os = await import("os");
    const fs = await import("fs");

    dotenv.config({ path: path.resolve(process.cwd(), "solora_relayer/.env") });
    dotenv.config();

    const anchor = await import("@coral-xyz/anchor");
    const web3 = await import("@solana/web3.js");

    const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
    const PROGRAM_ID = new web3.PublicKey(
        process.env.SOLORA_PROGRAM_ID ?? "DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf"
    );

    const enclavePubkeyBase58 = process.env.SOLORA_ENCLAVE_PUBKEY;
    if (!enclavePubkeyBase58) {
        throw new Error("Missing SOLORA_ENCLAVE_PUBKEY in .env");
    }
    const enclavePubkey = new web3.PublicKey(enclavePubkeyBase58);

    const keypairPathRaw =
        process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");
    const keypairPath = keypairPathRaw.startsWith("~")
        ? path.join(os.homedir(), keypairPathRaw.slice(1))
        : keypairPathRaw;

    const keypairFile = fs.readFileSync(keypairPath, "utf8");
    const secret = JSON.parse(keypairFile) as number[];
    const authority = web3.Keypair.fromSecretKey(Uint8Array.from(secret));

    const connection = new web3.Connection(RPC_URL, "confirmed");
    const wallet = {
        publicKey: authority.publicKey,
        signTransaction: async (tx: any) => {
            tx.partialSign(authority);
            return tx;
        },
        signAllTransactions: async (txs: any[]) => {
            txs.forEach((tx: any) => tx.partialSign(authority));
            return txs;
        },
    };

    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);

    const idlPath = process.env.SOLORA_IDL_PATH
        ? path.resolve(process.env.SOLORA_IDL_PATH)
        : path.resolve(process.cwd(), "target/idl/solora.json");

    if (!fs.existsSync(idlPath)) {
        throw new Error(`IDL not found at ${idlPath}. Set SOLORA_IDL_PATH if needed.`);
    }

    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

    const program = new anchor.Program(idl as any, provider);

    const [soloraWalletPda] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("solora"), authority.publicKey.toBuffer()],
        PROGRAM_ID
    );

    const maxTradeSizeUsdc = new anchor.BN(1_000);
    const maxSlippageBps = 25;

    console.log("RPC:", RPC_URL);
    console.log("Program ID:", PROGRAM_ID.toBase58());
    console.log("Authority:", authority.publicKey.toBase58());
    console.log("Solora PDA:", soloraWalletPda.toBase58());
    console.log("Enclave Pubkey:", enclavePubkey.toBase58());

    const signature = await (program.methods as any)
        .initializeWallet(maxTradeSizeUsdc, maxSlippageBps, enclavePubkey)
        .accounts({
            soloraWallet: soloraWalletPda,
            authority: authority.publicKey,
            systemProgram: web3.SystemProgram.programId,
        })
        .rpc();

    console.log("Initialize tx signature:", signature);
    await connection.confirmTransaction(signature, "confirmed");

    const state = await (program.account as any).soloraWallet.fetch(soloraWalletPda);

    console.log("Initialization verified:");
    console.log("  authority:", state.authority.toBase58());
    console.log("  enclaveSigner:", state.enclaveSigner.toBase58());
    console.log("  isActive:", state.isActive);
}

main().catch((err) => {
    console.error("Initialization failed:", err);
    process.exit(1);
});
