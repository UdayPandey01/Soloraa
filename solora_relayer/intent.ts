import { PublicKey, AccountMeta } from "@solana/web3.js";
import { createHash } from "crypto";

export const INTENT_DOMAIN = Buffer.from("SOLORA_INTENT_V2");
export const INTENT_MSG_LEN = 169;

export enum IntentKind {
    Transfer = 0,
    ArbitraryCpi = 1,
}

export interface IntentMessageInput {
    programId: PublicKey;
    walletPda: PublicKey;
    nonce: bigint;
    expirySlot: bigint;
    recentBlockhash: Buffer;
    blockhashSlot: bigint;
    kind: IntentKind;
    payloadHash: Buffer;
}

export function buildIntentMessage(input: IntentMessageInput): Buffer {
    if (input.payloadHash.length !== 32) {
        throw new Error(`payloadHash must be 32 bytes, got ${input.payloadHash.length}`);
    }
    if (input.recentBlockhash.length !== 32) {
        throw new Error(
            `recentBlockhash must be 32 bytes, got ${input.recentBlockhash.length}`
        );
    }
    const buf = Buffer.alloc(INTENT_MSG_LEN);
    INTENT_DOMAIN.copy(buf, 0);
    Buffer.from(input.programId.toBuffer()).copy(buf, 16);
    Buffer.from(input.walletPda.toBuffer()).copy(buf, 48);
    buf.writeBigUInt64LE(input.nonce, 80);
    buf.writeBigUInt64LE(input.expirySlot, 88);
    input.recentBlockhash.copy(buf, 96);
    buf.writeBigUInt64LE(input.blockhashSlot, 128);
    buf.writeUInt8(input.kind, 136);
    input.payloadHash.copy(buf, 137);
    return buf;
}

export function transferPayloadHash(destination: PublicKey, amount: bigint): Buffer {
    const h = createHash("sha256");
    h.update(Buffer.from([IntentKind.Transfer]));
    h.update(Buffer.from(destination.toBuffer()));
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(amount, 0);
    h.update(amountBuf);
    return h.digest();
}

export interface ArbitraryCpiPayloadInput {
    targetProgram: PublicKey;
    instructionData: Buffer;
    accountMetas: AccountMeta[];
}

export function arbitraryCpiPayloadHash(input: ArbitraryCpiPayloadInput): Buffer {
    const ixDataHash = createHash("sha256").update(input.instructionData).digest();

    const accountsParts: Buffer[] = [];
    for (const meta of input.accountMetas) {
        accountsParts.push(Buffer.from(meta.pubkey.toBuffer()));
        accountsParts.push(Buffer.from([meta.isSigner ? 1 : 0]));
        accountsParts.push(Buffer.from([meta.isWritable ? 1 : 0]));
    }
    const accountsHash = createHash("sha256")
        .update(Buffer.concat(accountsParts))
        .digest();

    const h = createHash("sha256");
    h.update(Buffer.from([IntentKind.ArbitraryCpi]));
    h.update(Buffer.from(input.targetProgram.toBuffer()));
    h.update(ixDataHash);
    h.update(accountsHash);
    return h.digest();
}

export const SLOT_HASHES_SYSVAR_ID = new PublicKey(
    "SysvarS1otHashes111111111111111111111111111"
);

export function parseMostRecentSlotHash(data: Buffer): { slot: bigint; hash: Buffer } {
    if (data.length < 8) {
        throw new Error(`SlotHashes data too short: ${data.length} bytes`);
    }
    const count = data.readBigUInt64LE(0);
    if (count === 0n) {
        throw new Error("SlotHashes is empty (no recent slots recorded)");
    }
    const slot = data.readBigUInt64LE(8);
    const hash = Buffer.from(data.subarray(16, 48));
    return { slot, hash };
}
