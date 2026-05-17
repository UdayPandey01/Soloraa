import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import * as web3 from "@solana/web3.js";
import { HttpEnclaveClient } from "./enclave_client.js";
import { SLOT_HASHES_SYSVAR_ID } from "./intent.js";

const PORT = Number(process.env.SOLORA_RELAYER_PORT ?? 8081);
const HOST = process.env.SOLORA_RELAYER_HOST ?? "0.0.0.0";

const PROGRAM_ID_STR =
    process.env.SOLORA_PROGRAM_ID ?? "8tkBctMGe5CsGQ731t9di9hBjGg7rbMo4VEk8WujvTPS";
const PROGRAM_ID = new web3.PublicKey(PROGRAM_ID_STR);

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CLUSTER = process.env.SOLORA_CLUSTER ?? "devnet";

const ENCLAVE_URL =
    process.env.SOLORA_ENCLAVE_URL ?? "http://127.0.0.1:8080";

const KEYPAIR_PATH =
    process.env.SOLANA_KEYPAIR_PATH ??
    path.join(os.homedir(), ".config", "solana", "id.json");

function loadKeypair(p: string): web3.Keypair {
    const raw = fs.readFileSync(p, "utf8");
    return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function explorerUrl(sig: string): string {
    const suffix = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
    return `https://explorer.solana.com/tx/${sig}${suffix}`;
}

function loadIdl(): anchor.Idl {
    const candidates = [
        process.env.SOLORA_IDL_PATH,
        path.resolve(process.cwd(), "target/idl/solora.json"),
        path.resolve(process.cwd(), "solora_relayer/solora.json"),
    ].filter(Boolean) as string[];
    for (const p of candidates) {
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as anchor.Idl;
    }
    throw new Error("IDL not found");
}

const authority = loadKeypair(KEYPAIR_PATH);
const connection = new web3.Connection(RPC_URL, "confirmed");
const provider = new anchor.AnchorProvider(
    connection,
    {
        publicKey: authority.publicKey,
        signTransaction: async (tx: any) => { tx.partialSign(authority); return tx; },
        signAllTransactions: async (txs: any[]) => { txs.forEach(t => t.partialSign(authority)); return txs; },
    } as any,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
);
anchor.setProvider(provider);
const program = new anchor.Program(loadIdl() as any, provider);
const enclaveClient = new HttpEnclaveClient(ENCLAVE_URL);

interface ExecuteCycleRequest {
    authority?: string;
    destination: string;
    amountLamports: number | string;
    cycle?: number;
    agentId?: string;
}

interface ExecuteCycleResponse {
    signature: string;
    explorerUrl: string;
    cycle?: number;
    nonceBefore: string;
}

async function executeCycle(req: ExecuteCycleRequest): Promise<ExecuteCycleResponse> {
    const authorityPubkey = req.authority
        ? new web3.PublicKey(req.authority)
        : authority.publicKey;
    const destination = new web3.PublicKey(req.destination);
    const amount = BigInt(req.amountLamports);

    const [walletPda] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("solora"), authorityPubkey.toBuffer()],
        PROGRAM_ID
    );

    const walletState: any = await (program.account as any).soloraWallet.fetch(walletPda);
    const nonce = BigInt(walletState.nonce.toString());

    const slot = BigInt(await connection.getSlot("confirmed"));
    const expirySlot = slot + 200n;

    const signed = await enclaveClient.signTransferIntent({
        walletPda,
        destination,
        amountLamports: amount,
        expirySlot,
    });

    const edIx = web3.Ed25519Program.createInstructionWithPublicKey({
        publicKey: Buffer.from(signed.pubkey),
        message: Buffer.from(signed.message),
        signature: Buffer.from(signed.signature),
    });

    const executeIx = await (program.methods as any)
        .executeTransfer(new anchor.BN(amount.toString()))
        .accounts({
            soloraWallet: walletPda,
            payer: authority.publicKey,
            destination,
            instructionsSysvar: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
            slotHashesSysvar: SLOT_HASHES_SYSVAR_ID,
        })
        .instruction();

    const tx = new web3.Transaction().add(
        web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        edIx,
        executeIx
    );
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(authority);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(sig, "confirmed");

    return {
        signature: sig,
        explorerUrl: explorerUrl(sig),
        cycle: req.cycle,
        nonceBefore: nonce.toString(),
    };
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

function withCors(res: http.ServerResponse) {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
}

function send(res: http.ServerResponse, status: number, body: unknown) {
    withCors(res);
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        withCors(res);
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method === "GET" && req.url === "/health") {
        send(res, 200, { status: "ok", programId: PROGRAM_ID_STR, cluster: CLUSTER });
        return;
    }

    if (req.method === "GET" && req.url === "/pubkey") {
        try {
            const bytes = await enclaveClient.getPubkey();
            const bs58 = (await import("bs58")).default;
            send(res, 200, {
                authority: authority.publicKey.toBase58(),
                enclavePubkey: bs58.encode(bytes),
            });
        } catch (e) {
            send(res, 502, { error: "enclave_unreachable", detail: String(e) });
        }
        return;
    }

    if (req.method === "POST" && req.url === "/execute-cycle") {
        try {
            const body = JSON.parse(await readBody(req)) as ExecuteCycleRequest;
            if (!body.destination) {
                send(res, 400, { error: "missing destination" });
                return;
            }
            if (body.amountLamports == null) {
                send(res, 400, { error: "missing amountLamports" });
                return;
            }
            const result = await executeCycle(body);
            send(res, 200, result);
        } catch (e: any) {
            const detail = e?.message ?? String(e);
            const status = /policy_rejected|wallet_state_invalid|too short/i.test(detail) ? 400 : 500;
            send(res, status, { error: "execute_cycle_failed", detail });
        }
        return;
    }

    send(res, 404, { error: "not_found" });
});

server.listen(PORT, HOST, () => {
    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        event: "relayer_started",
        host: HOST,
        port: PORT,
        programId: PROGRAM_ID_STR,
        rpc: RPC_URL,
        enclave: ENCLAVE_URL,
        authority: authority.publicKey.toBase58(),
    }));
});
