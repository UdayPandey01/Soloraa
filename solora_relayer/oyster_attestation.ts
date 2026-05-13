/**
 * Off-chain governor: Marlin Oyster attestation parser.
 *
 * The Solora enclave (running inside a Marlin Oyster CVM) exposes a
 * `/attestation` endpoint that returns an AWS Nitro NSM document encoded
 * as CBOR-Sign1. This module:
 *
 *  1. Fetches the document from a deployed enclave.
 *  2. Decodes the CBOR-Sign1 envelope.
 *  3. Extracts the embedded PCRs (PCR0/1/2), the enclave's public key
 *     (Ed25519 pubkey bytes Solora put in `user_data`), the nonce, and
 *     the timestamp.
 *
 * The bytes the governor signs and pushes on-chain are derived from this
 * output: `pcr0` becomes the registered measurement, `public_key` becomes
 * the wallet's `enclave_signer`.
 *
 * ───────────────────────────────────────────────────────────────────────
 * NOT YET IMPLEMENTED (REQUIRED BEFORE MAINNET)
 * ───────────────────────────────────────────────────────────────────────
 *
 * Real attestations require verifying the COSE-Sign1 ECDSA-P384 signature
 * against the AWS Nitro PKI root certificate, then walking the embedded
 * certificate chain. Until that lands, this parser TRUSTS the bytes it
 * receives. That means an attacker who can swap the URL the governor
 * fetches from can forge measurements.
 *
 * For devnet this is acceptable because the governor key is itself the
 * trust anchor on-chain. For mainnet, full COSE-Sign1 verification must
 * land — see TODO("COSE-Sign1 verify") below.
 *
 * Spec references:
 *   https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-attestation-process.html
 *   https://docs.marlin.org/learn/oyster/core-concepts/tee
 *   https://datatracker.ietf.org/doc/html/rfc8152#section-4.2  (COSE-Sign1)
 */

import { decode as cborDecode } from "cbor-x";

export interface OysterAttestation {
    /** The full PCR map keyed by index. PCR0 is the image hash. */
    pcrs: Record<number, Uint8Array>;
    /** Convenience: PCR0 as a 32-byte buffer (we register this on-chain). */
    pcr0: Uint8Array;
    /** Ed25519 pubkey bytes the enclave placed in `public_key`. 32 B. */
    publicKey: Uint8Array;
    /** Echo of the nonce the enclave (or caller) supplied. */
    nonce: Uint8Array;
    /** Echo of the user_data field. For Solora, equal to `publicKey`. */
    userData: Uint8Array;
    /** TEE timestamp (ms since epoch) — checked for freshness. */
    timestampMs: number;
    /** Hash algorithm string (always "SHA384" for AWS Nitro). */
    digest: string;
    /** The leaf certificate (DER bytes) — used by COSE verification when wired. */
    certificateDer: Uint8Array;
    /** Optional CA bundle (DER bytes per entry). */
    caBundleDer: Uint8Array[];
    /** Raw COSE-Sign1 bytes for downstream verification / audit logs. */
    rawCoseSign1: Uint8Array;
}

const OYSTER_DEFAULT_PORT = 1300;

/**
 * Fetch the raw attestation bytes from a deployed Marlin Oyster CVM. The
 * `enclaveUrl` is whatever HTTPS endpoint Oyster gives you back after a
 * successful deploy (e.g. `https://abc123.oyster.marlin.org`). Internally
 * the CVM proxies requests to the attestation server on port 1300.
 */
export async function fetchOysterAttestation(
    enclaveUrl: string,
    options: {
        publicKey: Uint8Array;
        nonce?: Uint8Array;
        fetchImpl?: typeof fetch;
    }
): Promise<Uint8Array> {
    const base = enclaveUrl.replace(/\/$/, "");
    const publicKeyHex = Buffer.from(options.publicKey).toString("hex");
    const nonceHex = options.nonce
        ? Buffer.from(options.nonce).toString("hex")
        : Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");

    const url = `${base}/attestation/raw?public_key=${publicKeyHex}&user_data=${publicKeyHex}&nonce=${nonceHex}`;
    const fetcher = options.fetchImpl ?? fetch;
    const resp = await fetcher(url, { method: "GET" });
    if (!resp.ok) {
        throw new Error(
            `Oyster attestation fetch failed: HTTP ${resp.status} from ${base} ` +
                `(is the CVM deployed and the attestation server bound on port ${OYSTER_DEFAULT_PORT}?)`
        );
    }
    const body = (await resp.text()).trim();

    // Accept either raw hex bytes or a JSON envelope with the hex inside.
    let hex: string;
    if (body.startsWith("{")) {
        const json = JSON.parse(body) as {
            attestation_doc?: string;
            attestation?: string;
        };
        const inner = json.attestation_doc ?? json.attestation;
        if (typeof inner !== "string") {
            throw new Error(
                "Oyster attestation JSON did not contain attestation_doc/attestation"
            );
        }
        hex = inner;
    } else {
        hex = body;
    }
    return Uint8Array.from(Buffer.from(hex, "hex"));
}

/**
 * Decode a raw AWS Nitro NSM attestation document (CBOR-Sign1) and pull
 * out the fields the on-chain registration needs.
 *
 * Does NOT verify the COSE-Sign1 signature yet — see file-level TODO.
 */
export function parseOysterAttestation(rawCoseSign1: Uint8Array): OysterAttestation {
    // COSE-Sign1 is an array of 4 elements:
    //   [protected_header_bstr, unprotected_header_map, payload_bstr, signature]
    const cose = cborDecode(rawCoseSign1) as unknown[];
    if (!Array.isArray(cose) || cose.length !== 4) {
        throw new Error(
            `attestation is not a COSE-Sign1 envelope (got ${Array.isArray(cose) ? `array len ${cose.length}` : typeof cose})`
        );
    }
    const [, , payloadBytes] = cose as [unknown, unknown, Uint8Array, Uint8Array];
    if (!(payloadBytes instanceof Uint8Array)) {
        throw new Error("COSE-Sign1 payload was not a byte string");
    }

    // TODO("COSE-Sign1 verify"): before mainnet, verify the 4th element
    // (signature) using ECDSA-P384 over Sig_structure(payload, protected)
    // with the leaf certificate's public key, AND walk the embedded
    // certificate chain to the pinned AWS Nitro root.

    const nsm = cborDecode(payloadBytes) as Record<string, unknown>;
    if (typeof nsm !== "object" || nsm === null) {
        throw new Error("NSM doc payload is not a CBOR map");
    }

    const pcrsField = nsm["pcrs"];
    if (!(pcrsField instanceof Map) && typeof pcrsField !== "object") {
        throw new Error("NSM doc missing or malformed pcrs map");
    }
    const pcrs: Record<number, Uint8Array> = {};
    const iter =
        pcrsField instanceof Map
            ? pcrsField.entries()
            : Object.entries(pcrsField as Record<string, unknown>);
    for (const [k, v] of iter as Iterable<[unknown, unknown]>) {
        const idx = typeof k === "number" ? k : Number(k);
        if (!Number.isFinite(idx) || !(v instanceof Uint8Array)) continue;
        pcrs[idx] = v;
    }
    const pcr0 = pcrs[0];
    if (!pcr0) throw new Error("NSM doc PCR0 missing — cannot register measurement");

    const publicKey = expectBytes(nsm["public_key"], "public_key");
    const userData = expectBytes(nsm["user_data"], "user_data");
    const nonce = expectBytes(nsm["nonce"], "nonce");
    const certificateDer = expectBytes(nsm["certificate"], "certificate");
    const cabundleField = nsm["cabundle"];
    const caBundleDer: Uint8Array[] = Array.isArray(cabundleField)
        ? cabundleField.filter((x): x is Uint8Array => x instanceof Uint8Array)
        : [];

    const timestamp = nsm["timestamp"];
    if (typeof timestamp !== "number" && typeof timestamp !== "bigint") {
        throw new Error("NSM doc timestamp missing or wrong type");
    }
    const digest = nsm["digest"];
    if (typeof digest !== "string") {
        throw new Error("NSM doc digest missing or not a string");
    }

    return {
        pcrs,
        pcr0,
        publicKey,
        userData,
        nonce,
        timestampMs: Number(timestamp),
        digest,
        certificateDer,
        caBundleDer,
        rawCoseSign1,
    };
}

/**
 * Convenience: fetch + parse in one call.
 */
export async function fetchAndParseOysterAttestation(
    enclaveUrl: string,
    options: { publicKey: Uint8Array; nonce?: Uint8Array }
): Promise<OysterAttestation> {
    const raw = await fetchOysterAttestation(enclaveUrl, options);
    return parseOysterAttestation(raw);
}

/**
 * Sanity-check that the attestation actually binds the enclave key we
 * expect to register. Throws if `user_data` or `public_key` doesn't match
 * the supplied `expectedPubkey`. Catches a remapping attack where the
 * governor fetches an attestation but it's for a different enclave.
 */
export function assertBindsPubkey(
    attestation: OysterAttestation,
    expectedPubkey: Uint8Array
): void {
    if (expectedPubkey.length !== 32) {
        throw new Error(
            `expectedPubkey must be 32 bytes (got ${expectedPubkey.length})`
        );
    }
    if (!bytesEqual(attestation.publicKey, expectedPubkey)) {
        throw new Error(
            `attestation public_key does not match expected enclave pubkey ` +
                `(got ${Buffer.from(attestation.publicKey).toString("hex")}, ` +
                `expected ${Buffer.from(expectedPubkey).toString("hex")})`
        );
    }
    // Solora sets both public_key and user_data to the same pubkey, so
    // user_data should also match — this catches some Oyster CVM versions
    // that mishandle one field but not the other.
    if (!bytesEqual(attestation.userData, expectedPubkey)) {
        throw new Error(
            "attestation user_data does not match expected enclave pubkey"
        );
    }
}

/**
 * Reject attestations older than the supplied window. Default 5 minutes.
 * The TEE timestamp is monotonic from the platform clock and is part of
 * the signed payload — once COSE-Sign1 verify lands, this becomes a hard
 * cryptographic freshness check.
 */
export function assertFresh(
    attestation: OysterAttestation,
    maxAgeMs = 5 * 60 * 1000
): void {
    const ageMs = Date.now() - attestation.timestampMs;
    if (ageMs > maxAgeMs) {
        throw new Error(
            `attestation is stale: ${(ageMs / 1000).toFixed(0)}s old ` +
                `(max ${(maxAgeMs / 1000).toFixed(0)}s)`
        );
    }
    if (ageMs < -60_000) {
        throw new Error(
            `attestation timestamp is in the future by ${(-ageMs / 1000).toFixed(0)}s — clock drift?`
        );
    }
}

// ── helpers ──────────────────────────────────────────────────────────────

function expectBytes(value: unknown, fieldName: string): Uint8Array {
    if (!(value instanceof Uint8Array)) {
        throw new Error(`NSM doc field "${fieldName}" missing or not bytes`);
    }
    return value;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    }
    return diff === 0;
}
