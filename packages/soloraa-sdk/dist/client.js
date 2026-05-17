import { PublicKey } from "@solana/web3.js";
import * as ed25519 from "@noble/ed25519";
import { DEFAULT_RELAYER_URL, ERROR_DOCS, ERROR_NAMES, INTENT_DOMAIN, INTENT_OFFSETS, SOLORA_INTENT_V2_BYTES, } from "./constants.js";
export class SoloraaClient {
    relayerUrl;
    walletAuthority;
    agentId;
    fetchImpl;
    constructor(config = {}) {
        this.relayerUrl = (config.relayerUrl ?? DEFAULT_RELAYER_URL).replace(/\/$/, "");
        if (config.walletAuthority) {
            this.walletAuthority =
                typeof config.walletAuthority === "string"
                    ? config.walletAuthority
                    : config.walletAuthority.toBase58();
        }
        this.agentId = config.agentId;
        this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    }
    /**
     * Ask the relayer to ask the enclave to sign a transfer intent, then
     * submit it on chain through the program's `execute_transfer` instruction.
     */
    async executeTransfer(req) {
        const destination = typeof req.destination === "string"
            ? req.destination
            : req.destination.toBase58();
        const amountLamports = typeof req.amountLamports === "bigint"
            ? Number(req.amountLamports)
            : req.amountLamports;
        const body = {
            destination,
            amountLamports,
        };
        if (this.walletAuthority)
            body.authority = this.walletAuthority;
        if (this.agentId)
            body.agentId = this.agentId;
        if (req.cycle != null)
            body.cycle = req.cycle;
        const resp = await this.fetchImpl(`${this.relayerUrl}/execute-cycle`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        const text = await resp.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new SoloraaExecutionError(undefined, undefined, `relayer returned non-JSON ${resp.status}: ${text.slice(0, 200)}`);
        }
        if (!resp.ok) {
            const detail = String(parsed?.detail ?? text);
            const code = extractErrorCode(detail);
            const name = code ? ERROR_NAMES[code] : undefined;
            const docUrl = code ? ERROR_DOCS[code] : undefined;
            throw new SoloraaExecutionError(code, name, docUrl
                ? `${name ?? `error ${code}`} — see ${docUrl}. Raw: ${detail}`
                : detail, docUrl);
        }
        if (!parsed?.signature || !parsed?.explorerUrl) {
            throw new SoloraaExecutionError(undefined, undefined, `relayer response missing signature/explorerUrl: ${text.slice(0, 200)}`);
        }
        return {
            signature: parsed.signature,
            explorerUrl: parsed.explorerUrl,
            nonceBefore: String(parsed.nonceBefore ?? ""),
            cycle: parsed.cycle,
        };
    }
    /** Liveness check. Returns the relayer's program ID + cluster. */
    async health() {
        const resp = await this.fetchImpl(`${this.relayerUrl}/health`);
        if (!resp.ok) {
            throw new Error(`relayer /health: ${resp.status}`);
        }
        return (await resp.json());
    }
    /** Returns the relayer's fee-payer pubkey and the live enclave pubkey. */
    async keys() {
        const resp = await this.fetchImpl(`${this.relayerUrl}/pubkey`);
        if (!resp.ok) {
            throw new Error(`relayer /pubkey: ${resp.status}`);
        }
        const json = (await resp.json());
        return {
            authority: String(json.authority),
            enclavePubkey: String(json.enclavePubkey),
        };
    }
    /**
     * Locally re-verify a (message, signature, pubkey) triple. Runs a real
     * Ed25519 check via @noble/ed25519; never trusts the enclave's word.
     *
     * Useful for replay tooling, audit logs, and observability pipelines
     * that want to validate signed bytes off the critical path.
     */
    async verifyIntent(input) {
        if (input.message.length !== SOLORA_INTENT_V2_BYTES) {
            return { ok: false, reason: "wrong_length" };
        }
        const domainBytes = input.message.slice(0, INTENT_DOMAIN.length);
        const domainStr = new TextDecoder().decode(domainBytes);
        if (domainStr !== INTENT_DOMAIN) {
            return { ok: false, reason: "wrong_domain" };
        }
        const sigOk = await this.verifyEd25519(input.message, input.signature, input.enclavePubkey);
        if (!sigOk) {
            return { ok: false, reason: "bad_signature" };
        }
        const fields = {
            domain: domainStr,
            programId: bytesToBase58(input.message.slice(INTENT_OFFSETS.programId, INTENT_OFFSETS.walletPda)),
            walletPda: bytesToBase58(input.message.slice(INTENT_OFFSETS.walletPda, INTENT_OFFSETS.nonce)),
            nonce: readU64LE(input.message, INTENT_OFFSETS.nonce),
            expirySlot: readU64LE(input.message, INTENT_OFFSETS.expirySlot),
            recentBlockhash: bytesToHex(input.message.slice(INTENT_OFFSETS.recentBlockhash, INTENT_OFFSETS.blockhashSlot)),
            blockhashSlot: readU64LE(input.message, INTENT_OFFSETS.blockhashSlot),
            kind: input.message[INTENT_OFFSETS.kind] ?? 0,
            payloadHash: bytesToHex(input.message.slice(INTENT_OFFSETS.payloadHash)),
        };
        return { ok: true, fields };
    }
    async verifyEd25519(message, signature, pubkeyBase58) {
        try {
            if (signature.length !== 64)
                return false;
            const pubkeyBytes = new PublicKey(pubkeyBase58).toBytes();
            if (pubkeyBytes.length !== 32)
                return false;
            return await ed25519.verifyAsync(signature, message, pubkeyBytes);
        }
        catch {
            return false;
        }
    }
}
export class SoloraaExecutionError extends Error {
    code;
    errorName;
    docUrl;
    constructor(code, errorName, message, docUrl) {
        super(message);
        this.name = "SoloraaExecutionError";
        this.code = code;
        this.errorName = errorName;
        this.docUrl = docUrl;
    }
}
function extractErrorCode(s) {
    const hex = s.match(/0x([0-9a-fA-F]+)/);
    if (hex)
        return parseInt(hex[1], 16);
    const decimal = s.match(/[Cc]ustom[:\s]*\(?(\d+)/);
    if (decimal)
        return parseInt(decimal[1], 10);
    return undefined;
}
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
function bytesToBase58(bytes) {
    return new PublicKey(bytes).toBase58();
}
function readU64LE(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    return view.getBigUint64(0, true);
}
//# sourceMappingURL=client.js.map