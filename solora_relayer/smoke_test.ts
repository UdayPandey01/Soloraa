async function main() {
    const path = await import("path");
    const fs = await import("fs");

    const anchor = await import("@coral-xyz/anchor");
    const web3 = await import("@solana/web3.js");
    const naclModule = await import("tweetnacl");
    const nacl = naclModule.default ?? naclModule;

    const {
        buildIntentMessage,
        IntentKind,
        transferPayloadHash,
        parseMostRecentSlotHash,
        INTENT_DOMAIN,
        INTENT_MSG_LEN,
    } = await import("./intent.js");
    const { MockEnclave } = await import("./mock_enclave.js");

    let pass = 0;
    let fail = 0;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            pass++;
            console.log(`  PASS  ${label}`);
        } else {
            fail++;
            console.log(`  FAIL  ${label}`);
        }
    };

    console.log("\n=== Solora relayer smoke test (offline) ===\n");

    console.log("[1] MockEnclave");
    const enclavePath = path.resolve(process.cwd(), "solora_relayer/mock_enclave.json");
    const enclave = MockEnclave.fromFile(enclavePath);
    check(enclave.publicKey.length === 32, "enclave.publicKey is 32 bytes");

    console.log("\n[2] Intent message");
    const programId = new web3.PublicKey("DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf");
    const walletPda = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("solora"), web3.Keypair.generate().publicKey.toBuffer()],
        programId
    )[0];
    const destination = web3.Keypair.generate().publicKey;
    const amount = 1_000_000n;
    const payloadHash = transferPayloadHash(destination, amount);
    check(payloadHash.length === 32, "transferPayloadHash returns 32 bytes");

    const recentBlockhash = Buffer.alloc(32, 0xab);
    const blockhashSlot = 9999n;
    const message = buildIntentMessage({
        programId,
        walletPda,
        nonce: 7n,
        expirySlot: 12345n,
        recentBlockhash,
        blockhashSlot,
        kind: IntentKind.Transfer,
        payloadHash,
    });
    check(message.length === INTENT_MSG_LEN, `message length === ${INTENT_MSG_LEN} bytes`);
    check(
        message.slice(0, 16).equals(INTENT_DOMAIN),
        "domain prefix === SOLORA_INTENT_V2"
    );
    check(
        message.slice(16, 48).equals(Buffer.from(programId.toBuffer())),
        "program_id at bytes 16..48"
    );
    check(
        message.slice(48, 80).equals(Buffer.from(walletPda.toBuffer())),
        "wallet_pda at bytes 48..80"
    );
    check(message.readBigUInt64LE(80) === 7n, "nonce LE at bytes 80..88");
    check(message.readBigUInt64LE(88) === 12345n, "expiry_slot LE at bytes 88..96");
    check(
        message.slice(96, 128).equals(recentBlockhash),
        "recent_blockhash at bytes 96..128"
    );
    check(message.readBigUInt64LE(128) === blockhashSlot, "blockhash_slot at bytes 128..136");
    check(message.readUInt8(136) === IntentKind.Transfer, "kind=0 at byte 136");
    check(
        message.slice(137, 169).equals(payloadHash),
        "payload_hash at bytes 137..169"
    );

    const fakeSlotHashes = Buffer.alloc(8 + 8 + 32);
    fakeSlotHashes.writeBigUInt64LE(1n, 0);
    fakeSlotHashes.writeBigUInt64LE(9999n, 8);
    Buffer.alloc(32, 0xab).copy(fakeSlotHashes, 16);
    const parsed = parseMostRecentSlotHash(fakeSlotHashes);
    check(parsed.slot === 9999n && parsed.hash.equals(recentBlockhash), "parseMostRecentSlotHash");

    console.log("\n[3] Sign / verify");
    const signature = enclave.sign(message);
    check(signature.length === 64, "signature is 64 bytes");
    check(
        nacl.sign.detached.verify(message, signature, enclave.publicKey),
        "ed25519 signature verifies against the enclave pubkey"
    );

    console.log("\n[4] Ed25519Program ix layout");
    const ed25519Ix = web3.Ed25519Program.createInstructionWithPublicKey({
        publicKey: enclave.publicKey,
        message: Uint8Array.from(message),
        signature,
    });
    const ixData = ed25519Ix.data;
    check(ixData[0] === 1, "count == 1");
    check(ixData[1] === 0, "padding == 0");

    const sigOffset = ixData.readUInt16LE(2);
    const sigIxIdx = ixData.readUInt16LE(4);
    const pkOffset = ixData.readUInt16LE(6);
    const pkIxIdx = ixData.readUInt16LE(8);
    const msgOffset = ixData.readUInt16LE(10);
    const msgSize = ixData.readUInt16LE(12);
    const msgIxIdx = ixData.readUInt16LE(14);
    check(sigIxIdx === 0xffff, "sig_ix_idx == 0xFFFF (inline)");
    check(pkIxIdx === 0xffff, "pk_ix_idx == 0xFFFF (inline)");
    check(msgIxIdx === 0xffff, "msg_ix_idx == 0xFFFF (inline)");
    check(msgSize === INTENT_MSG_LEN, `msg_size == ${INTENT_MSG_LEN} (V2)`);
    check(
        ixData.subarray(sigOffset, sigOffset + 64).equals(Buffer.from(signature)),
        "signature bytes at sig_offset"
    );
    check(
        ixData.subarray(pkOffset, pkOffset + 32).equals(Buffer.from(enclave.publicKey)),
        "pubkey bytes at pk_offset"
    );
    check(
        ixData.subarray(msgOffset, msgOffset + msgSize).equals(message),
        "message bytes at msg_offset"
    );

    console.log("\n[5] IDL parse via @coral-xyz/anchor");
    const idlPath = path.resolve(process.cwd(), "solora_relayer/solora.json");
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
    const dummyConn = new web3.Connection("http://localhost:8899", "processed");
    const dummyWallet = {
        publicKey: web3.Keypair.generate().publicKey,
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any[]) => txs,
    };
    const provider = new anchor.AnchorProvider(dummyConn, dummyWallet, {});
    const program = new anchor.Program(idl as any, provider);
    check(
        program.programId.toBase58() === programId.toBase58(),
        "program.programId matches IDL address"
    );
    const methodNames = Object.keys((program.methods as any));
    const expected = [
        "addAllowedProgram",
        "addMeasurement",
        "executeArbitraryCpi",
        "executeEscape",
        "executeTransfer",
        "initMeasurementRegistry",
        "initializeWallet",
        "initiateTimelock",
        "registerEnclave",
        "registerEnclaveV2",
        "removeAllowedProgram",
        "revokeMeasurement",
        "togglePause",
        "transferGovernor",
        "updatePolicy",
    ];
    for (const m of expected) {
        check(methodNames.includes(m), `method present: ${m}`);
    }
    check(
        Object.keys((program.account as any)).includes("soloraWallet"),
        "account namespace exposes soloraWallet"
    );



    console.log(`\n=== ${pass} pass, ${fail} fail ===\n`);
    if (fail > 0) process.exit(1);
}

main().catch((err) => {
    console.error("smoke_test failed:", err);
    process.exit(1);
});
