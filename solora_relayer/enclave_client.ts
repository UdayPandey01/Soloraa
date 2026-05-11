

import type { PublicKey } from "@solana/web3.js";

export interface SignedIntent {
    message: Uint8Array;
    signature: Uint8Array;
    pubkey: Uint8Array;
}

export interface SignTransferRequest {
    walletPda: PublicKey;
    destination: PublicKey;
    amountLamports: bigint;
    expirySlot: bigint;
}

export interface AccountMetaInput {
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
}

export interface SignTradeRequest {
    walletPda: PublicKey;
    targetProgram: PublicKey;
    instructionData: Uint8Array;
    accountMetas: AccountMetaInput[];
    sideIsBuy: boolean;
    tradeSizeUsdc: bigint;
    limitPriceE8: bigint;
    expectedSlippageBps: number;
    pythFeedIdHex: string;
    expirySlot: bigint;
}

export interface EnclaveClient {
    getPubkey(): Promise<Uint8Array>;
    signTransferIntent(req: SignTransferRequest): Promise<SignedIntent>;
    signTradeIntent(req: SignTradeRequest): Promise<SignedIntent>;
}

export class HttpEnclaveClient implements EnclaveClient {
    constructor(private readonly baseUrl: string) {}

    private url(path: string): string {
        return `${this.baseUrl.replace(/\/$/, "")}${path}`;
    }

    async getPubkey(): Promise<Uint8Array> {
        const r = await fetch(this.url("/pubkey"));
        if (!r.ok) throw new Error(`enclave /pubkey failed: ${r.status}`);
        const body = (await r.json()) as { pubkey_base58: string; pubkey_hex: string };
        const bs58 = await import("bs58");
        return bs58.default.decode(body.pubkey_base58);
    }

    async signTransferIntent(req: SignTransferRequest): Promise<SignedIntent> {
        const payload = {
            wallet_pda: req.walletPda.toBase58(),
            destination: req.destination.toBase58(),
            amount_lamports: Number(req.amountLamports),
            expiry_slot: Number(req.expirySlot),
        };
        return await this.postIntent("/sign-transfer-intent", payload);
    }

    async signTradeIntent(req: SignTradeRequest): Promise<SignedIntent> {
        const payload = {
            wallet_pda: req.walletPda.toBase58(),
            target_program: req.targetProgram.toBase58(),
            instruction_data_hex: Buffer.from(req.instructionData).toString("hex"),
            account_metas: req.accountMetas.map((m) => ({
                pubkey: m.pubkey.toBase58(),
                is_signer: m.isSigner,
                is_writable: m.isWritable,
            })),
            side_is_buy: req.sideIsBuy,
            trade_size_usdc: Number(req.tradeSizeUsdc),
            limit_price_e8: Number(req.limitPriceE8),
            expected_slippage_bps: req.expectedSlippageBps,
            pyth_feed_id_hex: req.pythFeedIdHex,
            expiry_slot: Number(req.expirySlot),
        };
        return await this.postIntent("/sign-trade-intent", payload);
    }

    private async postIntent(path: string, payload: object): Promise<SignedIntent> {
        const r = await fetch(this.url(path), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
        const text = await r.text();
        let parsed: any;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error(`enclave ${path} returned non-JSON: ${r.status} ${text.slice(0, 200)}`);
        }
        if (!r.ok) {
            const err = parsed?.error ?? "unknown";
            const detail = parsed?.detail ?? text;
            throw new Error(`enclave ${path} rejected (${err}): ${detail}`);
        }
        const message = Buffer.from(parsed.message_hex, "hex");
        if (message.length !== 169) {
            throw new Error(`enclave returned ${message.length}-byte message, expected 169`);
        }
        const signature = Buffer.from(parsed.signature_hex, "hex");
        if (signature.length !== 64) {
            throw new Error(`enclave returned ${signature.length}-byte signature, expected 64`);
        }
        const bs58 = await import("bs58");
        const pubkey = bs58.default.decode(parsed.pubkey_base58);
        return {
            message: new Uint8Array(message),
            signature: new Uint8Array(signature),
            pubkey,
        };
    }
}
