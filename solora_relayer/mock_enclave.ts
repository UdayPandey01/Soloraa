import * as fs from "fs";
import * as path from "path";
import nacl from "tweetnacl";

/**
 * MockEnclave stands in for a real Marlin Oyster CVM. The interface mirrors what
 * the production enclave will expose: take an opaque message, return an Ed25519
 * signature over it plus the verifying key. Swap the impl, keep the surface.
 */
export class MockEnclave {
    private readonly secretKey: Uint8Array;
    public readonly publicKey: Uint8Array;

    constructor(secretKey: Uint8Array) {
        if (secretKey.length !== 64) {
            throw new Error(`MockEnclave secret key must be 64 bytes (tweetnacl format), got ${secretKey.length}`);
        }
        this.secretKey = secretKey;
        this.publicKey = secretKey.slice(32);
    }

    static fromFile(filePath: string): MockEnclave {
        const resolved = path.resolve(filePath);
        const raw = fs.readFileSync(resolved, "utf8");
        const arr = JSON.parse(raw) as number[];
        return new MockEnclave(Uint8Array.from(arr));
    }

    sign(message: Uint8Array): Uint8Array {
        return nacl.sign.detached(message, this.secretKey);
    }
}
