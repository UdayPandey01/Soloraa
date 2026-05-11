async function main() {
    const dotenv = await import("dotenv");
    const path = await import("path");
    const os = await import("os");
    const fs = await import("fs");
    const crypto = await import("crypto");

    dotenv.config({ path: path.resolve(process.cwd(), "solora_relayer/.env") });
    dotenv.config();

    const traceId = crypto.randomUUID();

    const anchor = await import("@coral-xyz/anchor");
    const web3 = await import("@solana/web3.js");

    const {
        buildIntentMessage,
        IntentKind,
        transferPayloadHash,
        arbitraryCpiPayloadHash,
        parseMostRecentSlotHash,
        SLOT_HASHES_SYSVAR_ID,
    } = await import("./intent.js");
    const { MockEnclave } = await import("./mock_enclave.js");
    const { HttpEnclaveClient } = await import("./enclave_client.js");

    const PROGRAM_ID = new web3.PublicKey(
        process.env.SOLORA_PROGRAM_ID ?? "DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf"
    );
    const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
    const REGISTRY_SEED = "measurement_registry";

    const argv = process.argv.slice(2);
    const command = argv[0];

    const logEvent = (level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) => {
        const payload = {
            ts: new Date().toISOString(),
            level,
            event,
            trace_id: traceId,
            ...fields,
        };
        console.log(JSON.stringify(payload));
    };

    const logMetric = (name: string, value: number, fields: Record<string, unknown> = {}) => {
        const payload = {
            ts: new Date().toISOString(),
            metric: name,
            value,
            trace_id: traceId,
            ...fields,
        };
        console.log(JSON.stringify(payload));
    };

    if (!command) {
        usage();
        return;
    }

    const args = argv.slice(1);
    const parsedArgs = parseArgs(args);

    const connection = new web3.Connection(RPC_URL, "confirmed");
    const authority = loadKeypair(
        parsedArgs.getSingle("authority") ??
        process.env.SOLANA_KEYPAIR_PATH ??
        path.join(os.homedir(), ".config", "solana", "id.json")
    );

    const governor = loadKeypair(
        parsedArgs.getSingle("governor") ??
        process.env.SOLORA_GOVERNOR_KEYPAIR_PATH ??
        process.env.SOLANA_KEYPAIR_PATH ??
        path.join(os.homedir(), ".config", "solana", "id.json")
    );

    const provider = new anchor.AnchorProvider(connection, makeWallet(authority), {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Anchor 0.32+ takes (idl, provider). The IDL embeds the program id;
    // the older 3-arg form misroutes provider into the size-resolution path.
    const program = new anchor.Program(loadIdl() as any, provider);

    const registryPda = web3.PublicKey.findProgramAddressSync(
        [Buffer.from(REGISTRY_SEED)],
        PROGRAM_ID
    )[0];
    const walletPda = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("solora"), authority.publicKey.toBuffer()],
        PROGRAM_ID
    )[0];

    switch (command) {
        case "init-registry":
            await initRegistry(program, governor, registryPda, logEvent, logMetric);
            break;
        case "add-measurement":
            await addMeasurement(program, governor, registryPda, parsedArgs, logEvent, logMetric);
            break;
        case "revoke-measurement":
            await revokeMeasurement(program, governor, registryPda, parsedArgs, logEvent, logMetric);
            break;
        case "transfer-governor":
            await transferGovernor(program, governor, registryPda, parsedArgs, logEvent, logMetric);
            break;
        case "init-wallet":
            await initWallet(program, authority, walletPda, parsedArgs, logEvent, logMetric);
            break;
        case "register-enclave-v2":
            await registerEnclaveV2(
                program,
                governor,
                walletPda,
                registryPda,
                connection,
                parsedArgs,
                logEvent,
                logMetric
            );
            break;
        case "allowlist":
            await manageAllowlist(program, authority, walletPda, parsedArgs, logEvent, logMetric);
            break;
        case "transfer":
            await executeTransfer(
                program,
                authority,
                walletPda,
                connection,
                parsedArgs,
                logEvent,
                logMetric
            );
            break;
        case "cpi":
            await executeCpi(
                program,
                authority,
                walletPda,
                connection,
                parsedArgs,
                logEvent,
                logMetric
            );
            break;
        case "demo-local":
            await demoLocal(
                program,
                authority,
                governor,
                walletPda,
                registryPda,
                connection,
                parsedArgs,
                logEvent,
                logMetric
            );
            break;
        case "demo-devnet":
            await demoDevnet(
                program,
                authority,
                governor,
                walletPda,
                registryPda,
                connection,
                parsedArgs,
                logEvent,
                logMetric
            );
            break;
        default:
            usage();
    }

    function loadIdl(): anchor.Idl {
        const idlPath = resolveIdlPath();
        const raw = fs.readFileSync(idlPath, "utf8");
        return JSON.parse(raw) as anchor.Idl;
    }

    function resolveIdlPath(): string {
        const envPath = process.env.SOLORA_IDL_PATH;
        if (envPath && fs.existsSync(envPath)) {
            return envPath;
        }
        const candidate1 = path.resolve(process.cwd(), "target/idl/solora.json");
        if (fs.existsSync(candidate1)) {
            return candidate1;
        }
        const candidate2 = path.resolve(process.cwd(), "solora_relayer/solora.json");
        if (fs.existsSync(candidate2)) {
            return candidate2;
        }
        throw new Error("IDL not found. Run scripts/gen_idl.{ps1,sh} to generate it.");
    }

    function loadKeypair(keypairPath: string): web3.Keypair {
        const raw = fs.readFileSync(expandTilde(keypairPath), "utf8");
        const secret = JSON.parse(raw) as number[];
        return web3.Keypair.fromSecretKey(Uint8Array.from(secret));
    }

    function expandTilde(value: string): string {
        if (value.startsWith("~")) {
            return path.join(os.homedir(), value.slice(1));
        }
        return value;
    }

    function makeWallet(keypair: web3.Keypair) {
        return {
            publicKey: keypair.publicKey,
            signTransaction: async (tx: any) => {
                tx.partialSign(keypair);
                return tx;
            },
            signAllTransactions: async (txs: any[]) => {
                txs.forEach((tx: any) => tx.partialSign(keypair));
                return txs;
            },
        };
    }

    async function fundWalletPda(
        authority: web3.Keypair,
        walletPda: web3.PublicKey,
        connection: web3.Connection,
        lamports: bigint,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const current = (await connection.getBalance(walletPda)) ?? 0;
        const target = Number(lamports);
        if (current >= target) {
            log("info", "fund_wallet_skip", { wallet: walletPda.toBase58(), balance: current });
            return;
        }
        const delta = target - current;
        const tx = new web3.Transaction().add(
            web3.SystemProgram.transfer({
                fromPubkey: authority.publicKey,
                toPubkey: walletPda,
                lamports: delta,
            })
        );
        const sig = await web3.sendAndConfirmTransaction(connection, tx, [authority], {
            commitment: "confirmed",
        });
        log("info", "fund_wallet_ok", {
            wallet: walletPda.toBase58(),
            transferred: delta,
            new_balance: target,
            signature: sig,
        });
        metric("tx_sent", 1, { op: "fund_wallet" });
    }

    async function initRegistry(
        program: anchor.Program,
        governor: web3.Keypair,
        registry: web3.PublicKey,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        log("info", "registry_init_start", { registry: registry.toBase58(), governor: governor.publicKey.toBase58() });
        const sig = await (program.methods as any)
            .initMeasurementRegistry()
            .accounts({
                registry,
                governor: governor.publicKey,
                systemProgram: web3.SystemProgram.programId,
            })
            .signers([governor])
            .rpc();
        log("info", "registry_init_ok", { signature: sig });
        metric("tx_sent", 1, { op: "init_measurement_registry" });
    }

    async function addMeasurement(
        program: anchor.Program,
        governor: web3.Keypair,
        registry: web3.PublicKey,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const pcrHex = parsed.getSingle("pcr") ?? parsed.positionals[0] ?? process.env.SOLORA_MEASUREMENT_HASH;
        if (!pcrHex) {
            throw new Error("Missing --pcr <hex32>.");
        }
        const labelStr = parsed.getSingle("label") ?? "nitro_v2";
        const pcr = parseHex32(pcrHex);
        const label = labelBytes(labelStr);

        log("info", "measurement_add_start", { registry: registry.toBase58(), pcr: pcrHex, label: labelStr });
        const sig = await (program.methods as any)
            .addMeasurement(pcr, label)
            .accounts({
                registry,
                governor: governor.publicKey,
            })
            .signers([governor])
            .rpc();
        log("info", "measurement_add_ok", { signature: sig });
        metric("tx_sent", 1, { op: "add_measurement" });
    }

    async function revokeMeasurement(
        program: anchor.Program,
        governor: web3.Keypair,
        registry: web3.PublicKey,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const pcrHex = parsed.getSingle("pcr") ?? parsed.positionals[0] ?? process.env.SOLORA_MEASUREMENT_HASH;
        if (!pcrHex) {
            throw new Error("Missing --pcr <hex32>.");
        }
        const pcr = parseHex32(pcrHex);

        log("info", "measurement_revoke_start", { registry: registry.toBase58(), pcr: pcrHex });
        const sig = await (program.methods as any)
            .revokeMeasurement(pcr)
            .accounts({
                registry,
                governor: governor.publicKey,
            })
            .signers([governor])
            .rpc();
        log("info", "measurement_revoke_ok", { signature: sig });
        metric("tx_sent", 1, { op: "revoke_measurement" });
    }

    async function transferGovernor(
        program: anchor.Program,
        governor: web3.Keypair,
        registry: web3.PublicKey,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const newGovernorStr = parsed.getSingle("new") ?? parsed.positionals[0];
        if (!newGovernorStr) {
            throw new Error("Missing --new <pubkey>.");
        }
        const newGovernor = new web3.PublicKey(newGovernorStr);

        log("info", "governor_transfer_start", {
            registry: registry.toBase58(),
            from: governor.publicKey.toBase58(),
            to: newGovernor.toBase58(),
        });
        const sig = await (program.methods as any)
            .transferGovernor(newGovernor)
            .accounts({
                registry,
                governor: governor.publicKey,
            })
            .signers([governor])
            .rpc();
        log("info", "governor_transfer_ok", { signature: sig });
        metric("tx_sent", 1, { op: "transfer_governor" });
    }

    async function initWallet(
        program: anchor.Program,
        authority: web3.Keypair,
        walletPda: web3.PublicKey,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const maxTradeStr = parsed.getSingle("max-trade") ?? process.env.SOLORA_MAX_TRADE_USDC ?? "100000";
        const maxSlipStr = parsed.getSingle("max-slippage") ?? process.env.SOLORA_MAX_SLIPPAGE_BPS ?? "50";
        const maxTrade = new anchor.BN(maxTradeStr);
        const maxSlip = Number(maxSlipStr);

        const enclavePubkey = await resolveEnclavePubkey(parsed);

        log("info", "wallet_init_start", {
            wallet: walletPda.toBase58(),
            authority: authority.publicKey.toBase58(),
            enclave: enclavePubkey.toBase58(),
        });

        const sig = await (program.methods as any)
            .initializeWallet(maxTrade, maxSlip, enclavePubkey)
            .accounts({
                soloraWallet: walletPda,
                authority: authority.publicKey,
                systemProgram: web3.SystemProgram.programId,
            })
            .signers([authority])
            .rpc();
        log("info", "wallet_init_ok", { signature: sig });
        metric("tx_sent", 1, { op: "initialize_wallet" });
    }

    async function registerEnclaveV2(
        program: anchor.Program,
        governor: web3.Keypair,
        walletPda: web3.PublicKey,
        registry: web3.PublicKey,
        connection: web3.Connection,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const measurementHex =
            parsed.getSingle("measurement") ?? process.env.SOLORA_MEASUREMENT_HASH;
        if (!measurementHex) {
            throw new Error("Missing --measurement <hex32>.");
        }
        const measurement = parseHex32(measurementHex);

        const enclavePubkey = await resolveEnclavePubkey(parsed);

        const walletState: any = await (program.account as any).soloraWallet.fetch(walletPda);
        const nonce = BigInt(walletState.nonce.toString());
        const currentSlot = BigInt(await connection.getSlot("confirmed"));
        const expirySlots = BigInt(parsed.getSingle("expiry-slots") ?? process.env.SOLORA_ATTEST_EXPIRY_SLOTS ?? "200");
        const expirySlot = currentSlot + expirySlots;

        const attestationMsg = buildAttestationMessage(
            PROGRAM_ID,
            walletPda,
            enclavePubkey,
            measurement,
            currentSlot,
            expirySlot,
            nonce
        );

        const edIx = web3.Ed25519Program.createInstructionWithPrivateKey({
            privateKey: governor.secretKey,
            message: attestationMsg,
        });

        const regIx = await (program.methods as any)
            .registerEnclaveV2()
            .accounts({
                soloraWallet: walletPda,
                registry,
                instructionsSysvar: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
            })
            .instruction();

        const tx = new web3.Transaction().add(edIx, regIx);
        tx.feePayer = governor.publicKey;
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.sign(governor);

        log("info", "register_enclave_v2_start", {
            wallet: walletPda.toBase58(),
            enclave: enclavePubkey.toBase58(),
            measurement: measurementHex,
            nonce: nonce.toString(),
        });

        const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
        });
        await connection.confirmTransaction(sig, "confirmed");
        log("info", "register_enclave_v2_ok", { signature: sig });
        metric("tx_sent", 1, { op: "register_enclave_v2" });
    }

    async function manageAllowlist(
        program: anchor.Program,
        authority: web3.Keypair,
        walletPda: web3.PublicKey,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const action = parsed.positionals[0];
        const targetStr = parsed.positionals[1] ?? parsed.getSingle("target");
        if (action !== "add" && action !== "remove") {
            throw new Error("Usage: allowlist <add|remove> <target_program>");
        }
        if (!targetStr) {
            throw new Error("Missing target program pubkey.");
        }
        const target = new web3.PublicKey(targetStr);
        const methodName = action === "add" ? "addAllowedProgram" : "removeAllowedProgram";

        log("info", "allowlist_update_start", { action, target: target.toBase58() });
        const sig = await (program.methods as any)
        [methodName](target)
            .accounts({
                soloraWallet: walletPda,
                authority: authority.publicKey,
            })
            .signers([authority])
            .rpc();
        log("info", "allowlist_update_ok", { signature: sig });
        metric("tx_sent", 1, { op: "allowlist" });
    }

    async function executeTransfer(
        program: anchor.Program,
        authority: web3.Keypair,
        walletPda: web3.PublicKey,
        connection: web3.Connection,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const destinationStr =
            parsed.getSingle("destination") ?? parsed.positionals[0] ?? process.env.SOLORA_DESTINATION;
        if (!destinationStr) {
            throw new Error("Missing destination.");
        }
        const destination = new web3.PublicKey(destinationStr);
        const amountStr = parsed.getSingle("amount") ?? process.env.SOLORA_AMOUNT_LAMPORTS ?? "1000000";
        const amount = BigInt(amountStr);
        const expirySlotsAhead = BigInt(
            parsed.getSingle("expiry-slots") ?? process.env.SOLORA_EXPIRY_SLOTS_AHEAD ?? "60"
        );

        const enclaveMode = await resolveEnclaveMode(parsed, MockEnclave, HttpEnclaveClient);

        const walletState: any = await (program.account as any).soloraWallet.fetch(walletPda);
        const nonce = BigInt(walletState.nonce.toString());

        const slot = BigInt(await connection.getSlot("confirmed"));
        const expirySlot = slot + expirySlotsAhead;

        let signedMessage: Uint8Array;
        let signature: Uint8Array;
        let pubkey: Uint8Array;

        if (enclaveMode.mode === "http") {
            const signed = await enclaveMode.client.signTransferIntent({
                walletPda,
                destination,
                amountLamports: amount,
                expirySlot,
            });
            signedMessage = signed.message;
            signature = signed.signature;
            pubkey = signed.pubkey;
        } else {
            const slotHashesAccount = await connection.getAccountInfo(SLOT_HASHES_SYSVAR_ID);
            if (!slotHashesAccount) {
                throw new Error("SlotHashes sysvar account not returned by RPC.");
            }
            const { slot: blockhashSlot, hash: recentBlockhash } = parseMostRecentSlotHash(
                slotHashesAccount.data
            );
            const payloadHash = transferPayloadHash(destination, amount);
            const message = buildIntentMessage({
                programId: PROGRAM_ID,
                walletPda,
                nonce,
                expirySlot,
                recentBlockhash,
                blockhashSlot,
                kind: IntentKind.Transfer,
                payloadHash,
            });
            signature = enclaveMode.enclave.sign(message);
            signedMessage = Uint8Array.from(message);
            pubkey = enclaveMode.enclave.publicKey;
        }

        const edIx = web3.Ed25519Program.createInstructionWithPublicKey({
            publicKey: pubkey,
            message: signedMessage,
            signature,
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

        const cuLimit = Number(process.env.SOLORA_CU_LIMIT ?? "200000");
        const cuPriceMicroLamports = process.env.SOLORA_CU_PRICE_MICROLAMPORTS;

        const ixs: web3.TransactionInstruction[] = [];
        if (cuLimit > 0) {
            ixs.push(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
        }
        if (cuPriceMicroLamports) {
            ixs.push(
                web3.ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: BigInt(cuPriceMicroLamports),
                })
            );
        }
        ixs.push(edIx, executeIx);

        const tx = new web3.Transaction().add(...ixs);
        tx.feePayer = authority.publicKey;
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.sign(authority);

        log("info", "transfer_start", {
            wallet: walletPda.toBase58(),
            destination: destination.toBase58(),
            amount: amount.toString(),
            nonce: nonce.toString(),
        });

        const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
        });
        await connection.confirmTransaction(sig, "confirmed");
        log("info", "transfer_ok", { signature: sig });
        metric("tx_sent", 1, { op: "execute_transfer" });

        if (parsed.hasFlag("replay")) {
            // Real on-chain replay: rebuild the wrapping tx with a FRESH blockhash
            // but reuse the SAME signed intent. The original signature is bound to
            // a now-stale wallet.nonce, so the program's verifier rejects with
            // IntentNonceMismatch. A naive resubmit would just hit Solana's tx
            // dedup (same signature → "already processed") which doesn't actually
            // exercise the on-chain replay protection.
            try {
                const replayTx = new web3.Transaction().add(...tx.instructions);
                replayTx.feePayer = authority.publicKey;
                const fresh = await connection.getLatestBlockhash("confirmed");
                replayTx.recentBlockhash = fresh.blockhash;
                replayTx.sign(authority);
                await connection.sendRawTransaction(replayTx.serialize(), {
                    skipPreflight: false,
                    preflightCommitment: "confirmed",
                });
                log("warn", "transfer_replay_unexpected_success", {});
            } catch (err) {
                log("info", "transfer_replay_rejected", { error: String(err) });
            }
        }
    }

    async function executeCpi(
        program: anchor.Program,
        authority: web3.Keypair,
        walletPda: web3.PublicKey,
        connection: web3.Connection,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        const useSystemTransfer = parsed.hasFlag("system-transfer");
        let targetProgram: web3.PublicKey;
        let instructionData: Buffer;
        let accountMetas: web3.AccountMeta[];

        if (useSystemTransfer) {
            const destinationStr = parsed.getSingle("destination") ?? parsed.positionals[0];
            if (!destinationStr) {
                throw new Error("Missing --destination for --system-transfer.");
            }
            const amountStr = parsed.getSingle("amount") ?? "1000000";
            const amount = BigInt(amountStr);
            const destination = new web3.PublicKey(destinationStr);
            const sysIx = web3.SystemProgram.transfer({
                fromPubkey: walletPda,
                toPubkey: destination,
                lamports: Number(amount),
            });
            targetProgram = sysIx.programId;
            instructionData = Buffer.from(sysIx.data);
            accountMetas = sysIx.keys;
        } else {
            const targetStr = parsed.getSingle("target") ?? parsed.positionals[0];
            const dataHex = parsed.getSingle("data") ?? parsed.positionals[1];
            if (!targetStr || !dataHex) {
                throw new Error("Usage: cpi --target <program> --data <hex> [--account <pubkey:signer:writable>]...");
            }
            targetProgram = new web3.PublicKey(targetStr);
            instructionData = Buffer.from(stripHex(dataHex), "hex");
            accountMetas = parseAccountMetas(parsed.getMulti("account"), web3);
        }

        const expirySlotsAhead = BigInt(
            parsed.getSingle("expiry-slots") ?? process.env.SOLORA_EXPIRY_SLOTS_AHEAD ?? "60"
        );
        const slot = BigInt(await connection.getSlot("confirmed"));
        const expirySlot = slot + expirySlotsAhead;

        const enclaveMode = await resolveEnclaveMode(parsed, MockEnclave, HttpEnclaveClient);

        let signedMessage: Uint8Array;
        let signature: Uint8Array;
        let pubkey: Uint8Array;

        if (enclaveMode.mode === "http") {
            const side = (parsed.getSingle("side") ?? process.env.SOLORA_SIDE ?? "buy").toLowerCase();
            const tradeSize = BigInt(
                parsed.getSingle("trade-size") ?? process.env.SOLORA_TRADE_SIZE_USDC ?? "1000"
            );
            const limitPrice = BigInt(
                parsed.getSingle("limit-price") ?? process.env.SOLORA_LIMIT_PRICE_E8 ?? "15000000000"
            );
            const expectedSlippage = Number(
                parsed.getSingle("slippage") ?? process.env.SOLORA_EXPECTED_SLIPPAGE_BPS ?? "50"
            );
            const feedId = parsed.getSingle("feed") ?? process.env.SOLORA_PYTH_FEED_ID;
            if (!feedId) {
                throw new Error("Missing --feed <pyth_feed_id_hex> for enclave signing.");
            }

            const signed = await enclaveMode.client.signTradeIntent({
                walletPda,
                targetProgram,
                instructionData: instructionData,
                accountMetas: accountMetas.map((m) => ({
                    pubkey: m.pubkey,
                    isSigner: m.isSigner,
                    isWritable: m.isWritable,
                })),
                sideIsBuy: side !== "sell",
                tradeSizeUsdc: tradeSize,
                limitPriceE8: limitPrice,
                expectedSlippageBps: expectedSlippage,
                pythFeedIdHex: feedId,
                expirySlot,
            });
            signedMessage = signed.message;
            signature = signed.signature;
            pubkey = signed.pubkey;
        } else {
            const walletState: any = await (program.account as any).soloraWallet.fetch(walletPda);
            const nonce = BigInt(walletState.nonce.toString());
            const slotHashesAccount = await connection.getAccountInfo(SLOT_HASHES_SYSVAR_ID);
            if (!slotHashesAccount) {
                throw new Error("SlotHashes sysvar account not returned by RPC.");
            }
            const { slot: blockhashSlot, hash: recentBlockhash } = parseMostRecentSlotHash(
                slotHashesAccount.data
            );
            const payloadHash = arbitraryCpiPayloadHash({
                targetProgram,
                instructionData: instructionData,
                accountMetas,
            });
            const message = buildIntentMessage({
                programId: PROGRAM_ID,
                walletPda,
                nonce,
                expirySlot,
                recentBlockhash,
                blockhashSlot,
                kind: IntentKind.ArbitraryCpi,
                payloadHash,
            });
            signature = enclaveMode.enclave.sign(message);
            signedMessage = Uint8Array.from(message);
            pubkey = enclaveMode.enclave.publicKey;
        }

        const edIx = web3.Ed25519Program.createInstructionWithPublicKey({
            publicKey: pubkey,
            message: signedMessage,
            signature,
        });

        let builder = (program.methods as any)
            .executeArbitraryCpi(targetProgram, instructionData)
            .accounts({
                soloraWallet: walletPda,
                payer: authority.publicKey,
                instructionsSysvar: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
                slotHashesSysvar: SLOT_HASHES_SYSVAR_ID,
            })
            .remainingAccounts(accountMetas);

        const executeIx = await builder.instruction();

        const tx = new web3.Transaction().add(edIx, executeIx);
        tx.feePayer = authority.publicKey;
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.sign(authority);

        log("info", "cpi_start", {
            wallet: walletPda.toBase58(),
            target: targetProgram.toBase58(),
        });

        const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
        });
        await connection.confirmTransaction(sig, "confirmed");
        log("info", "cpi_ok", { signature: sig });
        metric("tx_sent", 1, { op: "execute_cpi" });

        if (parsed.hasFlag("replay")) {
            try {
                await connection.sendRawTransaction(tx.serialize(), {
                    skipPreflight: false,
                    preflightCommitment: "confirmed",
                });
                log("warn", "cpi_replay_unexpected_success", {});
            } catch (err) {
                log("info", "cpi_replay_rejected", { error: String(err) });
            }
        }
    }

    async function demoLocal(
        program: anchor.Program,
        authority: web3.Keypair,
        governor: web3.Keypair,
        walletPda: web3.PublicKey,
        registryPda: web3.PublicKey,
        connection: web3.Connection,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        log("info", "demo_local_start", { rpc: RPC_URL });

        await tryOp(() => initRegistry(program, governor, registryPda, log, metric), log, "init_registry");
        await tryOp(() => addMeasurement(program, governor, registryPda, parsed, log, metric), log, "add_measurement");

        const walletExists = await connection.getAccountInfo(walletPda);
        if (!walletExists) {
            await tryOp(() => initWallet(program, authority, walletPda, parsed, log, metric), log, "init_wallet");
        } else {
            log("info", "wallet_exists", { wallet: walletPda.toBase58() });
        }

        // Fund the wallet PDA above rent-exempt so subsequent transfers succeed.
        // Solora's execute_transfer enforces post-transfer balance >= rent-exempt
        // minimum; we top up to ~0.1 SOL so the demo can move 0.001 SOL freely.
        await tryOp(
            () => fundWalletPda(authority, walletPda, connection, BigInt(100_000_000), log, metric),
            log,
            "fund_wallet_pda"
        );

        await tryOp(
            () => registerEnclaveV2(program, governor, walletPda, registryPda, connection, parsed, log, metric),
            log,
            "register_enclave_v2"
        );

        const cpiRejectArgs = parsedArgsFrom([
            "--system-transfer",
            "--destination",
            parsed.getSingle("cpi-destination") ?? web3.Keypair.generate().publicKey.toBase58(),
            "--amount",
            parsed.getSingle("cpi-amount") ?? "1000000",
        ]);
        await tryOp(
            () => executeCpi(program, authority, walletPda, connection, cpiRejectArgs, log, metric),
            log,
            "policy_rejection_expected"
        );

        await tryOp(
            () => manageAllowlist(program, authority, walletPda, parsedArgsFrom(["add", web3.SystemProgram.programId.toBase58()]), log, metric),
            log,
            "allowlist_add"
        );

        const transferArgs = parsedArgsFrom([
            "--destination",
            parsed.getSingle("transfer-destination") ?? web3.Keypair.generate().publicKey.toBase58(),
            "--amount",
            parsed.getSingle("transfer-amount") ?? "1000000",
        ]);
        await tryOp(
            () => executeTransfer(program, authority, walletPda, connection, transferArgs, log, metric),
            log,
            "execute_transfer"
        );

        const cpiArgs = parsedArgsFrom([
            "--system-transfer",
            "--destination",
            parsed.getSingle("cpi-destination") ?? web3.Keypair.generate().publicKey.toBase58(),
            "--amount",
            parsed.getSingle("cpi-amount") ?? "1000000",
        ]);
        await tryOp(
            () => executeCpi(program, authority, walletPda, connection, cpiArgs, log, metric),
            log,
            "execute_cpi"
        );

        const replayArgs = parsedArgsFrom([
            "--replay",
            "--destination",
            parsed.getSingle("replay-destination") ?? web3.Keypair.generate().publicKey.toBase58(),
            "--amount",
            parsed.getSingle("replay-amount") ?? "1000000",
        ]);
        await tryOp(
            () => executeTransfer(program, authority, walletPda, connection, replayArgs, log, metric),
            log,
            "replay_rejection"
        );

        log("info", "demo_local_done", {});
    }

    async function demoDevnet(
        program: anchor.Program,
        authority: web3.Keypair,
        governor: web3.Keypair,
        walletPda: web3.PublicKey,
        registryPda: web3.PublicKey,
        connection: web3.Connection,
        parsed: ReturnType<typeof parseArgs>,
        log: typeof logEvent,
        metric: typeof logMetric
    ) {
        log("info", "demo_devnet_start", { rpc: RPC_URL });
        await tryOp(() => initRegistry(program, governor, registryPda, log, metric), log, "init_registry");
        await tryOp(() => addMeasurement(program, governor, registryPda, parsed, log, metric), log, "add_measurement");
        await tryOp(() => initWallet(program, authority, walletPda, parsed, log, metric), log, "init_wallet");
        await tryOp(
            () => registerEnclaveV2(program, governor, walletPda, registryPda, connection, parsed, log, metric),
            log,
            "register_enclave_v2"
        );
        await tryOp(
            () => manageAllowlist(program, authority, walletPda, parsedArgsFrom(["add", web3.SystemProgram.programId.toBase58()]), log, metric),
            log,
            "allowlist_add"
        );
        const transferArgs = parsedArgsFrom([
            "--destination",
            parsed.getSingle("transfer-destination") ?? web3.Keypair.generate().publicKey.toBase58(),
            "--amount",
            parsed.getSingle("transfer-amount") ?? "1000000",
        ]);
        await tryOp(
            () => executeTransfer(program, authority, walletPda, connection, transferArgs, log, metric),
            log,
            "execute_transfer"
        );
        const feed = parsed.getSingle("feed") ?? process.env.SOLORA_PYTH_FEED_ID;
        if (feed) {
            const cpiArgs = parsedArgsFrom([
                "--system-transfer",
                "--destination",
                parsed.getSingle("cpi-destination") ?? web3.Keypair.generate().publicKey.toBase58(),
                "--amount",
                parsed.getSingle("cpi-amount") ?? "1000000",
                "--feed",
                feed,
                "--enclave-url",
                parsed.getSingle("enclave-url") ?? process.env.SOLORA_ENCLAVE_URL ?? "",
            ]);
            await tryOp(
                () => executeCpi(program, authority, walletPda, connection, cpiArgs, log, metric),
                log,
                "execute_cpi"
            );
        } else {
            log("warn", "demo_devnet_skip_cpi", { reason: "missing feed id" });
        }
        log("info", "demo_devnet_done", {});
    }

    async function tryOp<T>(fn: () => Promise<T>, log: typeof logEvent, label: string): Promise<T | undefined> {
        try {
            return await fn();
        } catch (err) {
            log("warn", "demo_step_failed", { step: label, error: String(err) });
            return undefined;
        }
    }

    function parseHex32(input: string): Buffer {
        const buf = Buffer.from(stripHex(input), "hex");
        if (buf.length !== 32) {
            throw new Error(`Expected 32-byte hex, got ${buf.length}`);
        }
        return buf;
    }

    function labelBytes(label: string): Buffer {
        const buf = Buffer.alloc(32);
        buf.write(label, 0, "utf8");
        return buf;
    }

    function stripHex(value: string): string {
        return value.startsWith("0x") ? value.slice(2) : value;
    }

    function buildAttestationMessage(
        programId: web3.PublicKey,
        walletPda: web3.PublicKey,
        enclavePubkey: web3.PublicKey,
        measurementHash: Buffer,
        attestationSlot: bigint,
        expirySlot: bigint,
        walletNonce: bigint
    ): Buffer {
        const msg = Buffer.alloc(168);
        Buffer.from("SOLORA_ATTEST_V1").copy(msg, 0);
        programId.toBuffer().copy(msg, 16);
        walletPda.toBuffer().copy(msg, 48);
        enclavePubkey.toBuffer().copy(msg, 80);
        measurementHash.copy(msg, 112);
        msg.writeBigUInt64LE(attestationSlot, 144);
        msg.writeBigUInt64LE(expirySlot, 152);
        msg.writeBigUInt64LE(walletNonce, 160);
        return msg;
    }

    async function resolveEnclavePubkey(parsed: ReturnType<typeof parseArgs>): Promise<web3.PublicKey> {
        const envPubkey = parsed.getSingle("enclave-pubkey") ?? process.env.SOLORA_ENCLAVE_PUBKEY;
        if (envPubkey) {
            return new web3.PublicKey(envPubkey);
        }
        const envUrl = parsed.getSingle("enclave-url") ?? process.env.SOLORA_ENCLAVE_URL;
        if (envUrl) {
            const client = new HttpEnclaveClient(envUrl);
            const bytes = await client.getPubkey();
            return new web3.PublicKey(bytes);
        }
        const mockPath = parsed.getSingle("mock-enclave") ?? process.env.SOLORA_MOCK_ENCLAVE_PATH ?? "solora_relayer/mock_enclave.json";
        const enclave = loadOrCreateMockEnclave(mockPath);
        return new web3.PublicKey(enclave.publicKey);
    }

    async function resolveEnclaveMode(
        parsed: ReturnType<typeof parseArgs>,
        Mock: typeof MockEnclave,
        Http: typeof HttpEnclaveClient
    ): Promise<{ mode: "mock"; enclave: InstanceType<typeof MockEnclave> } | { mode: "http"; client: InstanceType<typeof HttpEnclaveClient> }> {
        const envUrl = parsed.getSingle("enclave-url") ?? process.env.SOLORA_ENCLAVE_URL;
        if (envUrl) {
            return { mode: "http", client: new Http(envUrl) };
        }
        const mockPath = parsed.getSingle("mock-enclave") ?? process.env.SOLORA_MOCK_ENCLAVE_PATH ?? "solora_relayer/mock_enclave.json";
        return { mode: "mock", enclave: loadOrCreateMockEnclave(mockPath) };
    }

    function loadOrCreateMockEnclave(filePath: string): InstanceType<typeof MockEnclave> {
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) {
            const kp = web3.Keypair.generate();
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
            fs.writeFileSync(resolved, JSON.stringify(Array.from(kp.secretKey)));
            logEvent("info", "mock_enclave_created", { path: resolved, pubkey: kp.publicKey.toBase58() });
        }
        return MockEnclave.fromFile(resolved);
    }

    function parseAccountMetas(specs: string[], web3mod: typeof web3): web3.AccountMeta[] {
        return specs.map((spec) => {
            const parts = spec.split(":");
            if (parts.length < 3) {
                throw new Error("Account spec must be pubkey:isSigner:isWritable");
            }
            const pubkey = new web3mod.PublicKey(parts[0]);
            const isSigner = parseBool(parts[1]);
            const isWritable = parseBool(parts[2]);
            return { pubkey, isSigner, isWritable };
        });
    }

    function parseBool(value: string): boolean {
        return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
    }

    function parsedArgsFrom(items: string[]): ReturnType<typeof parseArgs> {
        return parseArgs(items);
    }

    function parseArgs(input: string[]) {
        const positionals: string[] = [];
        const flags = new Map<string, string[]>();
        for (let i = 0; i < input.length; i++) {
            const token = input[i];
            if (token.startsWith("--")) {
                const key = token.slice(2);
                const value = input[i + 1];
                if (value && !value.startsWith("--")) {
                    if (!flags.has(key)) {
                        flags.set(key, []);
                    }
                    flags.get(key)!.push(value);
                    i++;
                } else {
                    flags.set(key, ["true"]);
                }
            } else {
                positionals.push(token);
            }
        }
        return {
            positionals,
            getSingle(name: string): string | undefined {
                const vals = flags.get(name);
                return vals ? vals[0] : undefined;
            },
            getMulti(name: string): string[] {
                return flags.get(name) ?? [];
            },
            hasFlag(name: string): boolean {
                return flags.has(name);
            },
        };
    }

    function usage() {
        console.log(`solora ops\n\nCommands:\n  init-registry\n  add-measurement --pcr <hex32> [--label <name>]\n  revoke-measurement --pcr <hex32>\n  transfer-governor --new <pubkey>\n  init-wallet [--enclave-url <url> | --enclave-pubkey <pubkey> | --mock-enclave <path>]\n  register-enclave-v2 --measurement <hex32> [--expiry-slots <n>]\n  allowlist <add|remove> <programId>\n  transfer <destination> [--amount <lamports>] [--replay]\n  cpi --system-transfer --destination <pubkey> --amount <lamports> [--replay]\n  cpi --target <program> --data <hex> [--account <pubkey:signer:writable>]...\n  demo-local\n  demo-devnet\n`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
