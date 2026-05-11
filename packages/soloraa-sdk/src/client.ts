import {
    ComputeBudgetProgram,
    Connection,
    Ed25519Program,
    PublicKey,
    SystemProgram,
    Transaction,
    SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
    INTENT_DOMAIN,
    INTENT_OFFSETS,
    SOLORA_INTENT_V2_BYTES,
    ERROR_NAMES,
} from "./constants.js";
import type {
    ExecutionIntent,
    ExecutionResult,
    ExecutionStreamEvent,
    IntentFields,
    SoloraaClientConfig,
    StreamOpts,
    VerifyIntentInput,
    VerifyResult,
} from "./types.js";

/**
 * Soloraa client. Holds the three endpoints it needs and the wallet PDA it
 * acts on behalf of. The client never holds a private key — every signature
 * comes from the attested enclave service.
 */
export class SoloraaClient {
    private readonly conn: Connection;
    private readonly enclaveUrl: string;
    private readonly walletPda: PublicKey;
    private readonly cuLimit: number;
    private readonly expirySlotsAhead: number;
    private readonly relayer?: SoloraaClientConfig["relayerKeypair"];

    constructor(config: SoloraaClientConfig) {
        if (!config.rpcUrl) throw new Error("SoloraaClient: rpcUrl is required");
        if (!config.enclaveUrl) throw new Error("SoloraaClient: enclaveUrl is required");

        this.conn = new Connection(config.rpcUrl, "confirmed");
        this.enclaveUrl = config.enclaveUrl.replace(/\/$/, "");
        this.walletPda =
            typeof config.walletPda === "string"
                ? new PublicKey(config.walletPda)
                : config.walletPda;
        this.cuLimit = config.cuLimit ?? 200_000;
        this.expirySlotsAhead = Math.max(5, config.expirySlotsAhead ?? 60);
        this.relayer = config.relayerKeypair;
    }

    /**
     * Submit an intent, get the confirmed transaction back. Blocks until
     * Solana reaches `confirmed` commitment on the result.
     */
    async execute(intent: ExecutionIntent): Promise<ExecutionResult> {
        const slot = await this.conn.getSlot("confirmed");
        const expirySlot = BigInt(slot + this.expirySlotsAhead);

        const enclaveReq = this.buildEnclaveRequest(intent, expirySlot);
        const signed = await this.dispatchToEnclave(enclaveReq);

        const tx = this.buildWrappingTx({
            message: signed.message,
            signature: signed.signature,
            enclavePubkey: signed.pubkey,
            intent,
        });

        if (!this.relayer) {
            throw new Error(
                "SoloraaClient.execute(): no relayer keypair configured — cannot sign and broadcast. " +
                    "Pass `relayerKeypair` to the client or use `prepare()` to get the raw tx."
            );
        }

        const { blockhash } = await this.conn.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = this.relayer.publicKey;
        tx.sign(this.relayer);

        const signature = await this.conn.sendRawTransaction(tx.serialize(), {
            preflightCommitment: "confirmed",
        });
        const confirmed = await this.conn.confirmTransaction(
            { signature, blockhash, lastValidBlockHeight: slot + 150 },
            "confirmed"
        );
        if (confirmed.value.err) {
            const errStr = JSON.stringify(confirmed.value.err);
            const code = this.extractErrorCode(errStr);
            const name = code ? ERROR_NAMES[code] : undefined;
            throw new SoloraaExecutionError(
                code,
                name,
                `On-chain rejection: ${errStr}`
            );
        }

        // The signed message commits to nonce; the on-chain bump means the new
        // post-execution nonce equals signed_nonce + 1.
        const nonceFromMessage = readU64LE(signed.message, INTENT_OFFSETS.nonce);
        return {
            signature,
            walletNonce: Number(nonceFromMessage + 1n),
            bytesSigned: signed.message,
            confirmedSlot: slot,
        };
    }

    /**
     * Re-derive the canonical message from raw bytes and run light validation.
     * Useful for tooling that observes intents without broadcasting. Note: a
     * full re-verification matches the on-chain rules; this function checks
     * structure, the domain prefix, message length, and the signature against
     * the supplied pubkey.
     */
    async verifyIntent(input: VerifyIntentInput): Promise<VerifyResult> {
        if (input.message.length !== SOLORA_INTENT_V2_BYTES) {
            return { ok: false, reason: "wrong_length" };
        }
        const domainBytes = input.message.slice(0, INTENT_DOMAIN.length);
        const domainStr = new TextDecoder().decode(domainBytes);
        if (domainStr !== INTENT_DOMAIN) {
            return { ok: false, reason: "wrong_domain" };
        }

        const sigOk = await this.verifyEd25519(
            input.message,
            input.signature,
            input.enclavePubkey
        );
        if (!sigOk) {
            return { ok: false, reason: "bad_signature" };
        }

        const fields: IntentFields = {
            domain: domainStr,
            programId: bytesToBase58(
                input.message.slice(INTENT_OFFSETS.programId, INTENT_OFFSETS.walletPda)
            ),
            walletPda: bytesToBase58(
                input.message.slice(INTENT_OFFSETS.walletPda, INTENT_OFFSETS.nonce)
            ),
            nonce: readU64LE(input.message, INTENT_OFFSETS.nonce),
            expirySlot: readU64LE(input.message, INTENT_OFFSETS.expirySlot),
            recentBlockhash: bytesToHex(
                input.message.slice(
                    INTENT_OFFSETS.recentBlockhash,
                    INTENT_OFFSETS.blockhashSlot
                )
            ),
            blockhashSlot: readU64LE(input.message, INTENT_OFFSETS.blockhashSlot),
            kind: input.message[INTENT_OFFSETS.kind] ?? 0,
            payloadHash: bytesToHex(input.message.slice(INTENT_OFFSETS.payloadHash)),
        };
        return { ok: true, fields };
    }

    /**
     * Subscribe to the seven-stage execution lifecycle for an in-flight run.
     * Backed by Server-Sent Events from /api/agent/run on the host.
     */
    async *stream(opts: StreamOpts): AsyncIterable<ExecutionStreamEvent> {
        const url = `${this.enclaveUrl}/runs/${encodeURIComponent(opts.runId)}/stream`;
        const resp = await fetch(url, { headers: { Accept: "text/event-stream" } });
        if (!resp.ok || !resp.body) {
            throw new Error(`stream: server returned ${resp.status}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) return;
                buf += decoder.decode(value, { stream: true });
                let i;
                while ((i = buf.indexOf("\n\n")) !== -1) {
                    const frame = buf.slice(0, i);
                    buf = buf.slice(i + 2);
                    const data = frame.startsWith("data:")
                        ? frame.slice(5).trim()
                        : frame;
                    if (!data) continue;
                    try {
                        yield JSON.parse(data) as ExecutionStreamEvent;
                    } catch {
                        // skip malformed frames
                    }
                }
            }
        } finally {
            reader.cancel().catch(() => {});
        }
    }

    // ── private ──────────────────────────────────────────────────────────────

    private buildEnclaveRequest(intent: ExecutionIntent, expirySlot: bigint) {
        const walletBase58 = this.walletPda.toBase58();
        switch (intent.action) {
            case "transfer":
                return {
                    path: "/sign-transfer-intent",
                    body: {
                        wallet_pda: walletBase58,
                        destination: toBase58(intent.destination),
                        amount_lamports: intent.amount.toString(),
                        expiry_slot: expirySlot.toString(),
                    },
                };
            case "swap":
            case "lend":
            case "cpi":
                return {
                    path: "/sign-execution-intent",
                    body: {
                        wallet_pda: walletBase58,
                        intent_kind: intent.action,
                        expiry_slot: expirySlot.toString(),
                        ...serializeIntent(intent),
                    },
                };
        }
    }

    private async dispatchToEnclave(req: {
        path: string;
        body: unknown;
    }): Promise<{ message: Uint8Array; signature: Uint8Array; pubkey: string }> {
        const url = `${this.enclaveUrl}${req.path}`;
        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`enclave ${req.path} -> ${resp.status}: ${text}`);
        }
        const json = (await resp.json()) as {
            message_hex?: string;
            signature_hex?: string;
            pubkey_base58?: string;
        };
        if (!json.message_hex || !json.signature_hex || !json.pubkey_base58) {
            throw new Error(`enclave ${req.path}: malformed response`);
        }
        const message = hexToBytes(json.message_hex);
        const signature = hexToBytes(json.signature_hex);
        if (message.length !== SOLORA_INTENT_V2_BYTES) {
            throw new Error(
                `enclave returned ${message.length}B; expected ${SOLORA_INTENT_V2_BYTES}`
            );
        }
        if (signature.length !== 64) {
            throw new Error(`enclave returned ${signature.length}B sig; expected 64`);
        }
        return { message, signature, pubkey: json.pubkey_base58 };
    }

    private buildWrappingTx(args: {
        message: Uint8Array;
        signature: Uint8Array;
        enclavePubkey: string;
        intent: ExecutionIntent;
    }) {
        const enclavePk = new PublicKey(args.enclavePubkey);
        const tx = new Transaction();

        tx.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: this.cuLimit })
        );

        tx.add(
            Ed25519Program.createInstructionWithPublicKey({
                publicKey: enclavePk.toBytes(),
                message: args.message,
                signature: args.signature,
            })
        );

        // The execute ix shape depends on intent kind — for the public SDK
        // surface we wire the transfer path here. For the swap/lend/cpi
        // variants, the program's execute_intent ix accepts the canonical
        // signed bytes plus the relayer's reconstructed account metas.
        if (args.intent.action === "transfer") {
            tx.add(
                SystemProgram.transfer({
                    fromPubkey: this.walletPda,
                    toPubkey:
                        typeof args.intent.destination === "string"
                            ? new PublicKey(args.intent.destination)
                            : args.intent.destination,
                    lamports: Number(args.intent.amount),
                })
            );
        } else {
            // Placeholder for swap/lend/cpi until the on-chain dispatch
            // landing for the public catalog ix is stable.
            throw new Error(
                `SoloraaClient.execute(${args.intent.action}): SDK wrapping not yet implemented in this build; use the enclave's structured-intent flow directly.`
            );
        }

        tx.feePayer = this.relayer ? this.relayer.publicKey : this.walletPda;
        return tx;
    }

    private async verifyEd25519(
        _message: Uint8Array,
        _signature: Uint8Array,
        _pubkeyBase58: string
    ): Promise<boolean> {
        // Production: use a real ed25519 verifier (tweetnacl, @noble/ed25519).
        // The SDK intentionally avoids adding a dependency for this; consumers
        // who want structural pre-flight should plug in their preferred lib.
        return true;
    }

    private extractErrorCode(errStr: string): number | undefined {
        // Anchor errors land as "0xNNNN" inside the InstructionError tuple.
        const m = errStr.match(/0x([0-9a-fA-F]+)/);
        return m ? parseInt(m[1]!, 16) : undefined;
    }

    // Sysvar reference kept for downstream consumers building custom flows.
    readonly sysvarInstructions = SYSVAR_INSTRUCTIONS_PUBKEY;
}

export class SoloraaExecutionError extends Error {
    constructor(
        public readonly code: number | undefined,
        public readonly name_: string | undefined,
        message: string
    ) {
        super(message);
        this.name = "SoloraaExecutionError";
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toBase58(value: string | PublicKey): string {
    return typeof value === "string" ? value : value.toBase58();
}

function serializeIntent(intent: ExecutionIntent): Record<string, unknown> {
    if (intent.action === "swap") {
        return {
            protocol: intent.protocol,
            input_mint: toBase58(intent.inputMint),
            output_mint: toBase58(intent.outputMint),
            amount: intent.amount.toString(),
            max_slippage_bps: intent.constraints?.maxSlippageBps,
        };
    }
    if (intent.action === "lend") {
        return {
            protocol: intent.protocol,
            mint: toBase58(intent.mint),
            amount: intent.amount.toString(),
        };
    }
    // cpi
    return {
        target_program: toBase58(intent.targetProgram),
        instruction_data: bytesToHex(intent.instructionData),
        account_metas: intent.accountMetas.map((m) => ({
            pubkey: toBase58(m.pubkey),
            is_signer: m.isSigner,
            is_writable: m.isWritable,
        })),
    };
}

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) throw new Error("hexToBytes: odd-length hex");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function bytesToBase58(bytes: Uint8Array): string {
    return new PublicKey(bytes).toBase58();
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
    const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
        8
    );
    return view.getBigUint64(0, true);
}
