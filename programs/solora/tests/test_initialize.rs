use {
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    ed25519_dalek::{Signer as DalekSigner, SigningKey},
    litesvm::LiteSVM,
    rand::rngs::OsRng,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn ed25519_program_id() -> Pubkey {
    Pubkey::new_from_array(solana_sdk_ids::ed25519_program::ID.to_bytes())
}

fn ix_sysvar_id() -> Pubkey {
    Pubkey::new_from_array(solana_sdk_ids::sysvar::instructions::ID.to_bytes())
}

fn slot_hashes_id() -> Pubkey {
    Pubkey::new_from_array(solana_sdk_ids::sysvar::slot_hashes::ID.to_bytes())
}

#[allow(clippy::too_many_arguments)]
fn build_intent_message(
    program_id: &Pubkey,
    wallet_pda: &Pubkey,
    nonce: u64,
    expiry_slot: u64,
    recent_blockhash: &[u8; 32],
    blockhash_slot: u64,
    kind: u8,
    payload_hash: &[u8; 32],
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(169);
    msg.extend_from_slice(b"SOLORA_INTENT_V2");
    msg.extend_from_slice(program_id.as_ref());
    msg.extend_from_slice(wallet_pda.as_ref());
    msg.extend_from_slice(&nonce.to_le_bytes());
    msg.extend_from_slice(&expiry_slot.to_le_bytes());
    msg.extend_from_slice(recent_blockhash);
    msg.extend_from_slice(&blockhash_slot.to_le_bytes());
    msg.push(kind);
    msg.extend_from_slice(payload_hash);
    msg
}

/// Read the most recent (slot, hash) entry from the SlotHashes sysvar that LiteSVM exposes.
/// Falls back to seeding a synthetic entry at the current slot if SlotHashes is empty
/// (LiteSVM does not auto-populate it on slot warps).
fn current_blockhash_pair(svm: &mut LiteSVM) -> ([u8; 32], u64) {
    use solana_hash::Hash;
    use solana_slot_hashes::SlotHashes;

    let sh = svm.get_sysvar::<SlotHashes>();
    if let Some(first) = sh.first() {
        return (first.1.to_bytes(), first.0);
    }

    // Seed an entry at the current slot so the verifier has something to look up.
    let current_slot = svm.get_sysvar::<solana_clock::Clock>().slot.max(1);
    let synthetic_hash = Hash::new_from_array([0xAB; 32]);
    let new_sh = SlotHashes::new(&[(current_slot, synthetic_hash)]);
    svm.set_sysvar(&new_sh);
    (synthetic_hash.to_bytes(), current_slot)
}

fn build_ed25519_ix(signing_key: &SigningKey, message: &[u8]) -> Instruction {
    let signature = signing_key.sign(message);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let header_len: u16 = 16;
    let sig_offset: u16 = header_len;
    let pk_offset: u16 = header_len + 64;
    let msg_offset: u16 = header_len + 64 + 32;
    let msg_size: u16 = message.len() as u16;

    let mut data = Vec::with_capacity((msg_offset as usize) + message.len());
    data.push(1u8); // count
    data.push(0u8); // padding
    data.extend_from_slice(&sig_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // sig_ix_idx = self
    data.extend_from_slice(&pk_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // pk_ix_idx = self
    data.extend_from_slice(&msg_offset.to_le_bytes());
    data.extend_from_slice(&msg_size.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // msg_ix_idx = self
    data.extend_from_slice(&signature.to_bytes());
    data.extend_from_slice(&pubkey_bytes);
    data.extend_from_slice(message);

    Instruction {
        program_id: ed25519_program_id(),
        accounts: vec![],
        data,
    }
}

fn fresh_svm() -> (LiteSVM, Pubkey) {
    let program_id = solora::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/solora.so");
    svm.add_program(program_id, bytes).unwrap();
    (svm, program_id)
}

fn init_wallet(svm: &mut LiteSVM, payer: &Keypair, enclave_pk: Pubkey) -> Pubkey {
    let program_id = solora::id();
    let (solora_wallet, _bump) =
        Pubkey::find_program_address(&[b"solora", payer.pubkey().as_ref()], &program_id);
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let init_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::InitializeWallet {
            max_trade_size_usdc: 100_000,
            max_slippage_bps: 50,
            dev_enclave_pubkey: enclave_pk,
        }
        .data(),
        solora::accounts::InitializeWallet {
            solora_wallet,
            authority: payer.pubkey(),
            system_program: solana_system_interface::program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx).unwrap();
    solora_wallet
}

fn fund_wallet_pda(svm: &mut LiteSVM, wallet_pda: &Pubkey, lamports: u64) {
    svm.airdrop(wallet_pda, lamports).unwrap();
}

#[test]
fn test_initialize() {
    let (mut svm, _) = fresh_svm();
    let payer = Keypair::new();
    let enclave_pk_bytes = SigningKey::generate(&mut OsRng).verifying_key().to_bytes();
    let enclave_pk = Pubkey::new_from_array(enclave_pk_bytes);
    let _wallet = init_wallet(&mut svm, &payer, enclave_pk);
}

#[test]
fn test_update_policy_and_toggle_pause() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_pk_bytes = SigningKey::generate(&mut OsRng).verifying_key().to_bytes();
    let enclave_pk = Pubkey::new_from_array(enclave_pk_bytes);
    let solora_wallet = init_wallet(&mut svm, &payer, enclave_pk);

    let update_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::UpdatePolicy {
            new_max_trade_size: 250_000,
            new_max_slippage: 25,
        }
        .data(),
        solora::accounts::UpdatePolicy {
            solora_wallet,
            authority: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    let update_msg =
        Message::new_with_blockhash(&[update_ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let update_tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(update_msg), &[&payer]).unwrap();
    assert!(svm.send_transaction(update_tx).is_ok());

    let pause_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::TogglePause {}.data(),
        solora::accounts::TogglePause {
            solora_wallet,
            authority: payer.pubkey(),
        }
        .to_account_metas(None),
    );
    let pause_msg =
        Message::new_with_blockhash(&[pause_ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let pause_tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(pause_msg), &[&payer]).unwrap();
    assert!(svm.send_transaction(pause_tx).is_ok());
}

struct TransferCtx {
    program_id: Pubkey,
    payer: Keypair,
    enclave_key: SigningKey,
    wallet_pda: Pubkey,
    destination: Pubkey,
}

fn setup_transfer_ctx(svm: &mut LiteSVM) -> TransferCtx {
    let program_id = solora::id();
    let payer = Keypair::new();
    let enclave_key = SigningKey::generate(&mut OsRng);
    let enclave_pk = Pubkey::new_from_array(enclave_key.verifying_key().to_bytes());
    let wallet_pda = init_wallet(svm, &payer, enclave_pk);
    fund_wallet_pda(svm, &wallet_pda, 10_000_000);
    let destination = Pubkey::new_from_array(Keypair::new().pubkey().to_bytes());

    TransferCtx {
        program_id,
        payer,
        enclave_key,
        wallet_pda,
        destination,
    }
}

struct TransferTxOpts<'a> {
    amount: u64,
    nonce: u64,
    expiry_slot: u64,
    recent_blockhash: [u8; 32],
    blockhash_slot: u64,
    signer_override: Option<&'a SigningKey>,
    skip_ed25519_ix: bool,
    /// If Some, override the (blockhash, slot) used for the SIGNED message only.
    /// Useful for testing mismatched-blockhash and slot-not-found rejection paths.
    signed_blockhash_override: Option<([u8; 32], u64)>,
}

fn build_execute_transfer_tx(
    svm: &LiteSVM,
    ctx: &TransferCtx,
    opts: &TransferTxOpts,
) -> VersionedTransaction {
    let payload_hash = solora::transfer_payload_hash(&ctx.destination, opts.amount);
    let (signed_bh, signed_bh_slot) = opts
        .signed_blockhash_override
        .unwrap_or((opts.recent_blockhash, opts.blockhash_slot));
    let intent_msg = build_intent_message(
        &ctx.program_id,
        &ctx.wallet_pda,
        opts.nonce,
        opts.expiry_slot,
        &signed_bh,
        signed_bh_slot,
        0u8,
        &payload_hash,
    );

    let signing_key = opts.signer_override.unwrap_or(&ctx.enclave_key);
    let ed_ix = build_ed25519_ix(signing_key, &intent_msg);

    let exec_ix = Instruction::new_with_bytes(
        ctx.program_id,
        &solora::instruction::ExecuteTransfer {
            amount: opts.amount,
        }
        .data(),
        solora::accounts::ExecuteTransfer {
            solora_wallet: ctx.wallet_pda,
            payer: ctx.payer.pubkey(),
            destination: ctx.destination,
            instructions_sysvar: ix_sysvar_id(),
            slot_hashes_sysvar: slot_hashes_id(),
        }
        .to_account_metas(None),
    );

    let ixs: Vec<Instruction> = if opts.skip_ed25519_ix {
        vec![exec_ix]
    } else {
        vec![ed_ix, exec_ix]
    };

    let msg = Message::new_with_blockhash(&ixs, Some(&ctx.payer.pubkey()), &svm.latest_blockhash());
    VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.payer]).unwrap()
}

#[test]
fn test_transfer_happy_path_with_compute_budget_first() {
    use anchor_lang::solana_program::instruction::AccountMeta;

    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);

    let amount = 1_000_000u64;
    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let payload_hash = solora::transfer_payload_hash(&ctx.destination, amount);
    let intent_msg = build_intent_message(
        &ctx.program_id,
        &ctx.wallet_pda,
        0,
        expiry,
        &recent_bh,
        bh_slot,
        0u8,
        &payload_hash,
    );
    let ed_ix = build_ed25519_ix(&ctx.enclave_key, &intent_msg);

    let exec_ix = Instruction::new_with_bytes(
        ctx.program_id,
        &solora::instruction::ExecuteTransfer { amount }.data(),
        solora::accounts::ExecuteTransfer {
            solora_wallet: ctx.wallet_pda,
            payer: ctx.payer.pubkey(),
            destination: ctx.destination,
            instructions_sysvar: ix_sysvar_id(),
            slot_hashes_sysvar: slot_hashes_id(),
        }
        .to_account_metas(None),
    );

    // ComputeBudgetProgram::set_compute_unit_limit(200_000)
    let compute_budget_id = Pubkey::new_from_array(solana_sdk_ids::compute_budget::ID.to_bytes());
    let mut cb_data = vec![2u8]; // SetComputeUnitLimit discriminator
    cb_data.extend_from_slice(&200_000u32.to_le_bytes());
    let cb_ix = Instruction {
        program_id: compute_budget_id,
        accounts: Vec::<AccountMeta>::new(),
        data: cb_data,
    };

    // ComputeBudget at 0, Ed25519 at 1, execute at 2.
    let msg = Message::new_with_blockhash(
        &[cb_ix, ed_ix, exec_ix],
        Some(&ctx.payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(
        res.is_ok(),
        "transfer with ComputeBudget at index 0 should succeed: {:?}",
        res.err()
    );
}

fn default_transfer_opts(
    recent_bh: [u8; 32],
    bh_slot: u64,
    expiry_slot: u64,
) -> TransferTxOpts<'static> {
    TransferTxOpts {
        amount: 1_000_000u64,
        nonce: 0,
        expiry_slot,
        recent_blockhash: recent_bh,
        blockhash_slot: bh_slot,
        signer_override: None,
        skip_ed25519_ix: false,
        signed_blockhash_override: None,
    }
}

#[test]
fn test_transfer_happy_path() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);

    let dest_balance_before = svm.get_balance(&ctx.destination).unwrap_or(0);
    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let opts = default_transfer_opts(recent_bh, bh_slot, expiry);

    let tx = build_execute_transfer_tx(&svm, &ctx, &opts);
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "transfer should succeed: {:?}", res.err());

    let dest_balance_after = svm.get_balance(&ctx.destination).unwrap_or(0);
    assert_eq!(dest_balance_after - dest_balance_before, opts.amount);
}

#[test]
fn test_transfer_replay_rejected_after_nonce_increment() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);

    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let opts = default_transfer_opts(recent_bh, bh_slot, expiry);

    let tx = build_execute_transfer_tx(&svm, &ctx, &opts);
    svm.send_transaction(tx).unwrap();

    let replay_tx = build_execute_transfer_tx(&svm, &ctx, &opts);
    let res = svm.send_transaction(replay_tx);
    assert!(res.is_err(), "replay with same nonce should fail");
}

#[test]
fn test_transfer_wrong_signer_rejected() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);

    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let bad_key = SigningKey::generate(&mut OsRng);
    let mut opts = default_transfer_opts(recent_bh, bh_slot, expiry);
    opts.signer_override = Some(&bad_key);

    let tx = build_execute_transfer_tx(&svm, &ctx, &opts);
    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "wrong-signer intent should be rejected");
}

#[test]
fn test_transfer_missing_ed25519_ix_rejected() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);

    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let mut opts = default_transfer_opts(recent_bh, bh_slot, expiry);
    opts.skip_ed25519_ix = true;

    let tx = build_execute_transfer_tx(&svm, &ctx, &opts);
    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "tx without Ed25519 ix should be rejected");
}

#[test]
fn test_transfer_expired_intent_rejected() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);

    let current_slot = svm.get_sysvar::<solana_clock::Clock>().slot;
    let expired = if current_slot == 0 {
        0
    } else {
        current_slot - 1
    };

    if current_slot == 0 {
        svm.warp_to_slot(2);
    }

    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);
    let opts = default_transfer_opts(recent_bh, bh_slot, expired);

    let tx = build_execute_transfer_tx(&svm, &ctx, &opts);
    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "expired intent should be rejected");
}

#[test]
fn test_transfer_payload_mismatch_rejected() {
    // Sign for one amount, try to execute a different amount
    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);

    let signed_amount = 1_000_000u64;
    let executed_amount = 2_000_000u64;
    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;

    let payload_hash = solora::transfer_payload_hash(&ctx.destination, signed_amount);
    let intent_msg = build_intent_message(
        &ctx.program_id,
        &ctx.wallet_pda,
        0,
        expiry,
        &recent_bh,
        bh_slot,
        0u8,
        &payload_hash,
    );
    let ed_ix = build_ed25519_ix(&ctx.enclave_key, &intent_msg);

    let exec_ix = Instruction::new_with_bytes(
        ctx.program_id,
        &solora::instruction::ExecuteTransfer {
            amount: executed_amount,
        }
        .data(),
        solora::accounts::ExecuteTransfer {
            solora_wallet: ctx.wallet_pda,
            payer: ctx.payer.pubkey(),
            destination: ctx.destination,
            instructions_sysvar: ix_sysvar_id(),
            slot_hashes_sysvar: slot_hashes_id(),
        }
        .to_account_metas(None),
    );

    let msg = Message::new_with_blockhash(
        &[ed_ix, exec_ix],
        Some(&ctx.payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "payload-hash mismatch should be rejected");
}

#[test]
fn test_transfer_blockhash_mismatch_rejected() {
    // Sign with a real slot but a fake hash. Verifier finds the slot in SlotHashes
    // but the hash doesn't match -> BlockhashMismatch.
    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (real_bh, bh_slot) = current_blockhash_pair(&mut svm);

    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let mut opts = default_transfer_opts(real_bh, bh_slot, expiry);
    let fake_hash = [0xCDu8; 32];
    opts.signed_blockhash_override = Some((fake_hash, bh_slot));

    let tx = build_execute_transfer_tx(&svm, &ctx, &opts);
    let err = svm
        .send_transaction(tx)
        .expect_err("mismatched blockhash should be rejected");
    let logs = format!("{:?}", err);
    assert!(
        logs.contains("BlockhashMismatch") || logs.contains("Custom("),
        "expected BlockhashMismatch: {}",
        logs
    );
}

#[test]
fn test_transfer_blockhash_slot_not_found_rejected() {
    // Sign with a slot that does NOT exist in SlotHashes -> BlockhashSlotNotFound.
    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (real_bh, _bh_slot) = current_blockhash_pair(&mut svm);

    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let mut opts = default_transfer_opts(real_bh, 0, expiry);
    let unknown_slot = u64::MAX - 7;
    opts.signed_blockhash_override = Some((real_bh, unknown_slot));

    let tx = build_execute_transfer_tx(&svm, &ctx, &opts);
    let err = svm
        .send_transaction(tx)
        .expect_err("unknown blockhash slot should be rejected");
    let logs = format!("{:?}", err);
    assert!(
        logs.contains("BlockhashSlotNotFound") || logs.contains("Custom("),
        "expected BlockhashSlotNotFound: {}",
        logs
    );
}

#[test]
fn test_transfer_replay_with_aged_blockhash_rejected() {
    // Sign at slot S. Then warp the chain forward and overwrite SlotHashes so slot S
    // is no longer present (simulating SlotHashes retention scrolling past). Replay
    // -> BlockhashSlotNotFound.
    use solana_hash::Hash;
    use solana_slot_hashes::SlotHashes;

    let (mut svm, _) = fresh_svm();
    let ctx = setup_transfer_ctx(&mut svm);
    let (real_bh, bh_slot) = current_blockhash_pair(&mut svm);

    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 1_000;
    let opts = default_transfer_opts(real_bh, bh_slot, expiry);

    // Construct the signed tx but DO NOT broadcast yet. Then age the chain so the
    // SlotHashes window forgets `bh_slot`.
    let tx = build_execute_transfer_tx(&svm, &ctx, &opts);

    let new_slot = bh_slot + 600;
    svm.warp_to_slot(new_slot);
    let fresh_hash = Hash::new_from_array([0x77u8; 32]);
    let new_sh = SlotHashes::new(&[(new_slot, fresh_hash)]);
    svm.set_sysvar(&new_sh);

    let err = svm
        .send_transaction(tx)
        .expect_err("replay with aged blockhash should be rejected");
    let logs = format!("{:?}", err);
    assert!(
        logs.contains("BlockhashSlotNotFound") || logs.contains("Custom("),
        "expected BlockhashSlotNotFound: {}",
        logs
    );
}

fn fetch_wallet(svm: &LiteSVM, pda: &Pubkey) -> solora::SoloraWallet {
    use anchor_lang::AccountDeserialize;
    let acc = svm.get_account(pda).expect("wallet account exists");
    solora::SoloraWallet::try_deserialize(&mut &acc.data[..]).expect("decodes wallet")
}

fn add_allowed_ix(
    program_id: Pubkey,
    wallet_pda: Pubkey,
    authority: Pubkey,
    target: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &solora::instruction::AddAllowedProgram {
            target_program: target,
        }
        .data(),
        solora::accounts::ManageAllowlist {
            solora_wallet: wallet_pda,
            authority,
        }
        .to_account_metas(None),
    )
}

fn remove_allowed_ix(
    program_id: Pubkey,
    wallet_pda: Pubkey,
    authority: Pubkey,
    target: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &solora::instruction::RemoveAllowedProgram {
            target_program: target,
        }
        .data(),
        solora::accounts::ManageAllowlist {
            solora_wallet: wallet_pda,
            authority,
        }
        .to_account_metas(None),
    )
}

fn send_one(svm: &mut LiteSVM, ix: Instruction, signer: &Keypair) -> Result<(), String> {
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer])
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx).map_err(|e| format!("{:?}", e))?;
    Ok(())
}

fn registry_pda(program_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[solora::MEASUREMENT_REGISTRY_SEED], program_id).0
}

fn governor_keys() -> (Keypair, SigningKey) {
    // Use a single Ed25519 source: solana_keypair::Keypair internally stores a
    // 32-byte secret, and ed25519_dalek::SigningKey is built from those same
    // 32 bytes so on-chain Ed25519 verification of governor sigs over the
    // canonical attestation message lines up with the Solana keypair we use
    // to sign the wrapping tx (and pay fees).
    let kp = Keypair::new();
    let secret = kp.to_bytes();
    let mut secret32 = [0u8; 32];
    secret32.copy_from_slice(&secret[..32]);
    let signing_key = SigningKey::from_bytes(&secret32);
    debug_assert_eq!(
        signing_key.verifying_key().to_bytes(),
        kp.pubkey().to_bytes(),
        "governor solana keypair and ed25519 signing key must agree"
    );
    (kp, signing_key)
}

fn init_registry(svm: &mut LiteSVM, governor: &Keypair) -> Pubkey {
    let program_id = solora::id();
    let registry = registry_pda(&program_id);
    svm.airdrop(&governor.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::InitMeasurementRegistry {}.data(),
        solora::accounts::InitMeasurementRegistry {
            registry,
            governor: governor.pubkey(),
            system_program: solana_system_interface::program::ID,
        }
        .to_account_metas(None),
    );
    send_one(svm, ix, governor).expect("init registry");
    registry
}

fn fetch_registry(svm: &LiteSVM, pda: &Pubkey) -> solora::MeasurementRegistry {
    use anchor_lang::AccountDeserialize;
    let acc = svm.get_account(pda).expect("registry account exists");
    solora::MeasurementRegistry::try_deserialize(&mut &acc.data[..]).expect("decodes registry")
}

fn label_bytes(label: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    let bytes = label.as_bytes();
    let len = bytes.len().min(32);
    out[..len].copy_from_slice(&bytes[..len]);
    out
}

fn build_attestation_message(
    program_id: &Pubkey,
    wallet_pda: &Pubkey,
    new_enclave_pubkey: &Pubkey,
    measurement_hash: &[u8; 32],
    attestation_slot: u64,
    expiry_slot: u64,
    wallet_nonce: u64,
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(solora::ATTEST_MSG_LEN);
    msg.extend_from_slice(solora::ATTEST_DOMAIN);
    msg.extend_from_slice(program_id.as_ref());
    msg.extend_from_slice(wallet_pda.as_ref());
    msg.extend_from_slice(new_enclave_pubkey.as_ref());
    msg.extend_from_slice(measurement_hash);
    msg.extend_from_slice(&attestation_slot.to_le_bytes());
    msg.extend_from_slice(&expiry_slot.to_le_bytes());
    msg.extend_from_slice(&wallet_nonce.to_le_bytes());
    msg
}

fn build_register_enclave_v2_tx(
    svm: &LiteSVM,
    payer: &Keypair,
    wallet_pda: Pubkey,
    registry: Pubkey,
    governor_signing_key: &SigningKey,
    attestation_msg: &[u8],
) -> VersionedTransaction {
    let program_id = solora::id();
    let ed_ix = build_ed25519_ix(governor_signing_key, attestation_msg);

    let reg_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::RegisterEnclaveV2 {}.data(),
        solora::accounts::RegisterEnclaveV2 {
            solora_wallet: wallet_pda,
            registry,
            instructions_sysvar: ix_sysvar_id(),
        }
        .to_account_metas(None),
    );

    let msg = Message::new_with_blockhash(
        &[ed_ix, reg_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap()
}

struct AttestationCtx {
    payer: Keypair,
    wallet_pda: Pubkey,
    registry: Pubkey,
    governor: Keypair,
    governor_signer: SigningKey,
    measurement_hash: [u8; 32],
}

fn setup_attestation_ctx(svm: &mut LiteSVM) -> AttestationCtx {
    let payer = Keypair::new();
    let initial_enclave = SigningKey::generate(&mut OsRng);
    let initial_enclave_pk = Pubkey::new_from_array(initial_enclave.verifying_key().to_bytes());
    let wallet_pda = init_wallet(svm, &payer, initial_enclave_pk);

    let (governor, governor_signer) = governor_keys();
    let registry = init_registry(svm, &governor);

    let measurement_hash = [0x11u8; 32];
    let label = label_bytes("nitro_v2");
    let add_ix = Instruction::new_with_bytes(
        solora::id(),
        &solora::instruction::AddMeasurement {
            pcr_hash: measurement_hash,
            label,
        }
        .data(),
        solora::accounts::ManageRegistry {
            registry,
            governor: governor.pubkey(),
        }
        .to_account_metas(None),
    );
    send_one(svm, add_ix, &governor).expect("add measurement");

    AttestationCtx {
        payer,
        wallet_pda,
        registry,
        governor,
        governor_signer,
        measurement_hash,
    }
}

#[test]
fn test_add_allowed_program_happy() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_pk =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);

    let target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
        &payer,
    )
    .expect("authority can add");

    let wallet = fetch_wallet(&svm, &wallet_pda);
    assert_eq!(wallet.policy.allowed_count, 1);
    assert_eq!(wallet.policy.allowed_programs[0], target);
    assert!(wallet.policy.contains(&target));
}

#[test]
fn test_add_allowed_program_rejects_non_authority() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    let enclave_pk =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);

    let target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let ix = add_allowed_ix(program_id, wallet_pda, attacker.pubkey(), target);
    let res = send_one(&mut svm, ix, &attacker);
    assert!(res.is_err(), "non-authority should be denied");
}

#[test]
fn test_add_allowed_program_rejects_duplicate() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_pk =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);

    let target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
        &payer,
    )
    .unwrap();

    let res = send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
        &payer,
    );
    assert!(res.is_err(), "duplicate add should be rejected");
}

#[test]
fn test_add_allowed_program_rejects_when_full() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_pk =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);

    for _ in 0..16 {
        let target =
            Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
        send_one(
            &mut svm,
            add_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
            &payer,
        )
        .expect("first 16 fit");
    }

    let target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let res = send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
        &payer,
    );
    assert!(res.is_err(), "17th add should fail");

    let wallet = fetch_wallet(&svm, &wallet_pda);
    assert_eq!(wallet.policy.allowed_count, 16);
}

#[test]
fn test_remove_allowed_program_happy() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_pk =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);

    let a = Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let b = Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());

    send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), a),
        &payer,
    )
    .unwrap();
    send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), b),
        &payer,
    )
    .unwrap();
    send_one(
        &mut svm,
        remove_allowed_ix(program_id, wallet_pda, payer.pubkey(), a),
        &payer,
    )
    .unwrap();

    let wallet = fetch_wallet(&svm, &wallet_pda);
    assert_eq!(wallet.policy.allowed_count, 1);
    assert!(wallet.policy.contains(&b));
    assert!(!wallet.policy.contains(&a));
}

#[test]
fn test_remove_allowed_program_not_found() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_pk =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);

    let target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let res = send_one(
        &mut svm,
        remove_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
        &payer,
    );
    assert!(res.is_err(), "remove of missing target should fail");
}

#[test]
fn test_execute_cpi_blocked_when_target_not_allowlisted() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_key = SigningKey::generate(&mut OsRng);
    let enclave_pk = Pubkey::new_from_array(enclave_key.verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);
    fund_wallet_pda(&mut svm, &wallet_pda, 10_000_000);

    let unauthorized_target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    let ix_data: Vec<u8> = vec![1, 2, 3];
    let payload_hash = solora::arbitrary_cpi_payload_hash(&unauthorized_target, &ix_data, &[]);
    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);
    let intent_msg = build_intent_message(
        &program_id,
        &wallet_pda,
        0,
        expiry,
        &recent_bh,
        bh_slot,
        1u8,
        &payload_hash,
    );
    let ed_ix = build_ed25519_ix(&enclave_key, &intent_msg);

    let exec_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::ExecuteArbitraryCpi {
            target_program: unauthorized_target,
            instruction_data: ix_data,
        }
        .data(),
        solora::accounts::ExecuteArbitrary {
            solora_wallet: wallet_pda,
            payer: payer.pubkey(),
            instructions_sysvar: ix_sysvar_id(),
            slot_hashes_sysvar: slot_hashes_id(),
        }
        .to_account_metas(None),
    );

    let msg = Message::new_with_blockhash(
        &[ed_ix, exec_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    let err = res.expect_err("should reject non-allowlisted target");
    let logs_blob = format!("{:?}", err);
    assert!(
        logs_blob.contains("TargetProgramNotAllowed") || logs_blob.contains("Custom("),
        "should fail with TargetProgramNotAllowed-like error: {}",
        logs_blob
    );
}

#[test]
fn test_execute_cpi_passes_allowlist_gate_when_target_added() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_key = SigningKey::generate(&mut OsRng);
    let enclave_pk = Pubkey::new_from_array(enclave_key.verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);
    fund_wallet_pda(&mut svm, &wallet_pda, 10_000_000);

    let target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
        &payer,
    )
    .unwrap();

    let ix_data: Vec<u8> = vec![1, 2, 3];
    let payload_hash = solora::arbitrary_cpi_payload_hash(&target, &ix_data, &[]);
    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);
    let intent_msg = build_intent_message(
        &program_id,
        &wallet_pda,
        0,
        expiry,
        &recent_bh,
        bh_slot,
        1u8,
        &payload_hash,
    );
    let ed_ix = build_ed25519_ix(&enclave_key, &intent_msg);

    let exec_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::ExecuteArbitraryCpi {
            target_program: target,
            instruction_data: ix_data,
        }
        .data(),
        solora::accounts::ExecuteArbitrary {
            solora_wallet: wallet_pda,
            payer: payer.pubkey(),
            instructions_sysvar: ix_sysvar_id(),
            slot_hashes_sysvar: slot_hashes_id(),
        }
        .to_account_metas(None),
    );

    let msg = Message::new_with_blockhash(
        &[ed_ix, exec_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    // The CPI itself fails (target program is not loaded), but failure must come from
    // the runtime invoking the target — not from our TargetProgramNotAllowed gate.
    let err = svm
        .send_transaction(tx)
        .expect_err("inner CPI to non-existent target fails");
    let logs_blob = format!("{:?}", err);
    assert!(
        !logs_blob.contains("TargetProgramNotAllowed"),
        "must not be blocked by allowlist gate: {}",
        logs_blob
    );
}

#[test]
fn test_execute_cpi_rejects_oversize_ix_data() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_key = SigningKey::generate(&mut OsRng);
    let enclave_pk = Pubkey::new_from_array(enclave_key.verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);
    fund_wallet_pda(&mut svm, &wallet_pda, 10_000_000);

    let target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
        &payer,
    )
    .unwrap();

    let ix_data: Vec<u8> = vec![0u8; 1025];
    let payload_hash = solora::arbitrary_cpi_payload_hash(&target, &ix_data, &[]);
    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);
    let intent_msg = build_intent_message(
        &program_id,
        &wallet_pda,
        0,
        expiry,
        &recent_bh,
        bh_slot,
        1u8,
        &payload_hash,
    );
    let ed_ix = build_ed25519_ix(&enclave_key, &intent_msg);

    let exec_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::ExecuteArbitraryCpi {
            target_program: target,
            instruction_data: ix_data,
        }
        .data(),
        solora::accounts::ExecuteArbitrary {
            solora_wallet: wallet_pda,
            payer: payer.pubkey(),
            instructions_sysvar: ix_sysvar_id(),
            slot_hashes_sysvar: slot_hashes_id(),
        }
        .to_account_metas(None),
    );

    let msg = Message::new_with_blockhash(
        &[ed_ix, exec_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let err = svm
        .send_transaction(tx)
        .expect_err("should reject oversize ix data");
    let logs_blob = format!("{:?}", err);
    assert!(
        logs_blob.contains("CpiInstructionDataTooLarge") || logs_blob.contains("Custom("),
        "should fail with CpiInstructionDataTooLarge: {}",
        logs_blob
    );
}

#[test]
fn test_execute_cpi_rejects_too_many_accounts() {
    let (mut svm, program_id) = fresh_svm();
    let payer = Keypair::new();
    let enclave_key = SigningKey::generate(&mut OsRng);
    let enclave_pk = Pubkey::new_from_array(enclave_key.verifying_key().to_bytes());
    let wallet_pda = init_wallet(&mut svm, &payer, enclave_pk);
    fund_wallet_pda(&mut svm, &wallet_pda, 10_000_000);

    let target =
        Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes());
    send_one(
        &mut svm,
        add_allowed_ix(program_id, wallet_pda, payer.pubkey(), target),
        &payer,
    )
    .unwrap();

    // Build 33 distinct remaining accounts (cap is 32)
    let extras: Vec<Pubkey> = (0..33)
        .map(|_| {
            Pubkey::new_from_array(SigningKey::generate(&mut OsRng).verifying_key().to_bytes())
        })
        .collect();

    let mut metas = solora::accounts::ExecuteArbitrary {
        solora_wallet: wallet_pda,
        payer: payer.pubkey(),
        instructions_sysvar: ix_sysvar_id(),
        slot_hashes_sysvar: slot_hashes_id(),
    }
    .to_account_metas(None);
    for k in extras.iter() {
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*k, false));
    }

    let ix_data: Vec<u8> = vec![1, 2, 3];

    // Build an AccountInfo-equivalent slice for payload-hash computation.
    // Since we control the test inputs, we can compute the hash by hand using the
    // same logic the program uses.
    let mut accounts_buf: Vec<u8> = Vec::with_capacity(extras.len() * 34);
    for k in extras.iter() {
        accounts_buf.extend_from_slice(k.as_ref());
        accounts_buf.push(0); // is_signer = false
        accounts_buf.push(0); // is_writable = false
    }
    let ix_data_hash: [u8; 32] = {
        use solana_sha256_hasher::hashv;
        hashv(&[&ix_data]).to_bytes()
    };
    let accounts_hash: [u8; 32] = {
        use solana_sha256_hasher::hashv;
        hashv(&[&accounts_buf]).to_bytes()
    };
    let payload_hash: [u8; 32] = {
        use solana_sha256_hasher::hashv;
        hashv(&[&[1u8], target.as_ref(), &ix_data_hash, &accounts_hash]).to_bytes()
    };

    let expiry = svm.get_sysvar::<solana_clock::Clock>().slot + 100;
    let (recent_bh, bh_slot) = current_blockhash_pair(&mut svm);
    let intent_msg = build_intent_message(
        &program_id,
        &wallet_pda,
        0,
        expiry,
        &recent_bh,
        bh_slot,
        1u8,
        &payload_hash,
    );
    let ed_ix = build_ed25519_ix(&enclave_key, &intent_msg);

    let exec_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::ExecuteArbitraryCpi {
            target_program: target,
            instruction_data: ix_data,
        }
        .data(),
        metas,
    );

    let msg = Message::new_with_blockhash(
        &[ed_ix, exec_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let err = svm
        .send_transaction(tx)
        .expect_err("should reject 33 remaining accounts");
    let logs_blob = format!("{:?}", err);
    assert!(
        logs_blob.contains("TooManyCpiAccounts") || logs_blob.contains("Custom("),
        "should fail with TooManyCpiAccounts: {}",
        logs_blob
    );
}

#[test]
fn test_init_measurement_registry() {
    let (mut svm, _) = fresh_svm();
    let (governor, _signer) = governor_keys();
    let registry = init_registry(&mut svm, &governor);

    let reg = fetch_registry(&svm, &registry);
    assert_eq!(reg.governor, governor.pubkey());
    assert_eq!(reg.count, 0);
}

#[test]
fn test_add_measurement() {
    let (mut svm, program_id) = fresh_svm();
    let (governor, _signer) = governor_keys();
    let registry = init_registry(&mut svm, &governor);

    let pcr_hash = [0x22u8; 32];
    let label = label_bytes("nitro_v2");
    let add_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::AddMeasurement { pcr_hash, label }.data(),
        solora::accounts::ManageRegistry {
            registry,
            governor: governor.pubkey(),
        }
        .to_account_metas(None),
    );
    send_one(&mut svm, add_ix, &governor).unwrap();

    let reg = fetch_registry(&svm, &registry);
    assert_eq!(reg.count, 1);
    assert_eq!(reg.measurements[0].pcr_hash, pcr_hash);
    assert!(reg.measurements[0].is_active());
}

#[test]
fn test_revoke_measurement() {
    let (mut svm, program_id) = fresh_svm();
    let (governor, _signer) = governor_keys();
    let registry = init_registry(&mut svm, &governor);

    let pcr_hash = [0x33u8; 32];
    let label = label_bytes("marlin_v2");
    let add_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::AddMeasurement { pcr_hash, label }.data(),
        solora::accounts::ManageRegistry {
            registry,
            governor: governor.pubkey(),
        }
        .to_account_metas(None),
    );
    send_one(&mut svm, add_ix, &governor).unwrap();

    let revoke_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::RevokeMeasurement { pcr_hash }.data(),
        solora::accounts::ManageRegistry {
            registry,
            governor: governor.pubkey(),
        }
        .to_account_metas(None),
    );
    send_one(&mut svm, revoke_ix, &governor).unwrap();

    let reg = fetch_registry(&svm, &registry);
    assert_eq!(reg.count, 1);
    assert!(!reg.measurements[0].is_active());
}

#[test]
fn test_transfer_governor() {
    let (mut svm, program_id) = fresh_svm();
    let (governor, _signer) = governor_keys();
    let registry = init_registry(&mut svm, &governor);

    let new_governor = Keypair::new();
    svm.airdrop(&new_governor.pubkey(), 1_000_000_000).unwrap();

    let transfer_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::TransferGovernor {
            new_governor: new_governor.pubkey(),
        }
        .data(),
        solora::accounts::ManageRegistry {
            registry,
            governor: governor.pubkey(),
        }
        .to_account_metas(None),
    );
    send_one(&mut svm, transfer_ix, &governor).unwrap();

    let reg = fetch_registry(&svm, &registry);
    assert_eq!(reg.governor, new_governor.pubkey());

    let pcr_hash = [0x44u8; 32];
    let label = label_bytes("post_transfer");
    let add_old = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::AddMeasurement { pcr_hash, label }.data(),
        solora::accounts::ManageRegistry {
            registry,
            governor: governor.pubkey(),
        }
        .to_account_metas(None),
    );
    assert!(send_one(&mut svm, add_old, &governor).is_err());

    let add_new = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::AddMeasurement { pcr_hash, label }.data(),
        solora::accounts::ManageRegistry {
            registry,
            governor: new_governor.pubkey(),
        }
        .to_account_metas(None),
    );
    assert!(send_one(&mut svm, add_new, &new_governor).is_ok());
}

#[test]
fn test_register_enclave_v2_success() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_attestation_ctx(&mut svm);

    let new_enclave = SigningKey::generate(&mut OsRng);
    let new_enclave_pk = Pubkey::new_from_array(new_enclave.verifying_key().to_bytes());
    let current_slot = svm.get_sysvar::<solana_clock::Clock>().slot;
    let expiry_slot = current_slot + 100;

    let attestation_msg = build_attestation_message(
        &solora::id(),
        &ctx.wallet_pda,
        &new_enclave_pk,
        &ctx.measurement_hash,
        current_slot,
        expiry_slot,
        0,
    );
    let tx = build_register_enclave_v2_tx(
        &svm,
        &ctx.payer,
        ctx.wallet_pda,
        ctx.registry,
        &ctx.governor_signer,
        &attestation_msg,
    );

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "register should succeed: {:?}", res.err());

    let wallet = fetch_wallet(&svm, &ctx.wallet_pda);
    assert_eq!(wallet.enclave_signer, new_enclave_pk);
    assert_eq!(wallet.nonce, 1);
}

#[test]
fn test_register_enclave_v2_expired_attestation_rejected() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_attestation_ctx(&mut svm);

    let mut current_slot = svm.get_sysvar::<solana_clock::Clock>().slot;
    if current_slot == 0 {
        svm.warp_to_slot(2);
        current_slot = 2;
    }
    let expiry_slot = current_slot - 1;

    let new_enclave = SigningKey::generate(&mut OsRng);
    let new_enclave_pk = Pubkey::new_from_array(new_enclave.verifying_key().to_bytes());
    let attestation_msg = build_attestation_message(
        &solora::id(),
        &ctx.wallet_pda,
        &new_enclave_pk,
        &ctx.measurement_hash,
        current_slot,
        expiry_slot,
        0,
    );
    let tx = build_register_enclave_v2_tx(
        &svm,
        &ctx.payer,
        ctx.wallet_pda,
        ctx.registry,
        &ctx.governor_signer,
        &attestation_msg,
    );

    let err = svm
        .send_transaction(tx)
        .expect_err("expired attestation should be rejected");
    let logs = format!("{:?}", err);
    assert!(
        logs.contains("AttestationExpired") || logs.contains("Custom("),
        "expected AttestationExpired: {}",
        logs
    );
}

#[test]
fn test_register_enclave_v2_revoked_measurement_rejected() {
    let (mut svm, program_id) = fresh_svm();
    let ctx = setup_attestation_ctx(&mut svm);

    let revoke_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::RevokeMeasurement {
            pcr_hash: ctx.measurement_hash,
        }
        .data(),
        solora::accounts::ManageRegistry {
            registry: ctx.registry,
            governor: ctx.governor.pubkey(),
        }
        .to_account_metas(None),
    );
    send_one(&mut svm, revoke_ix, &ctx.governor).unwrap();

    let new_enclave = SigningKey::generate(&mut OsRng);
    let new_enclave_pk = Pubkey::new_from_array(new_enclave.verifying_key().to_bytes());
    let current_slot = svm.get_sysvar::<solana_clock::Clock>().slot;
    let expiry_slot = current_slot + 100;

    let attestation_msg = build_attestation_message(
        &solora::id(),
        &ctx.wallet_pda,
        &new_enclave_pk,
        &ctx.measurement_hash,
        current_slot,
        expiry_slot,
        0,
    );
    let tx = build_register_enclave_v2_tx(
        &svm,
        &ctx.payer,
        ctx.wallet_pda,
        ctx.registry,
        &ctx.governor_signer,
        &attestation_msg,
    );

    let err = svm
        .send_transaction(tx)
        .expect_err("revoked measurement should be rejected");
    let logs = format!("{:?}", err);
    assert!(
        logs.contains("MeasurementRevoked") || logs.contains("Custom("),
        "expected MeasurementRevoked: {}",
        logs
    );
}

#[test]
fn test_register_enclave_v2_nonce_mismatch_rejected() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_attestation_ctx(&mut svm);

    let new_enclave = SigningKey::generate(&mut OsRng);
    let new_enclave_pk = Pubkey::new_from_array(new_enclave.verifying_key().to_bytes());
    let current_slot = svm.get_sysvar::<solana_clock::Clock>().slot;
    let expiry_slot = current_slot + 100;

    let attestation_msg = build_attestation_message(
        &solora::id(),
        &ctx.wallet_pda,
        &new_enclave_pk,
        &ctx.measurement_hash,
        current_slot,
        expiry_slot,
        1,
    );
    let tx = build_register_enclave_v2_tx(
        &svm,
        &ctx.payer,
        ctx.wallet_pda,
        ctx.registry,
        &ctx.governor_signer,
        &attestation_msg,
    );

    let err = svm
        .send_transaction(tx)
        .expect_err("nonce mismatch should be rejected");
    let logs = format!("{:?}", err);
    assert!(
        logs.contains("AttestationNonceMismatch") || logs.contains("Custom("),
        "expected AttestationNonceMismatch: {}",
        logs
    );
}

#[test]
fn test_register_enclave_v2_wrong_governor_signature_rejected() {
    let (mut svm, _) = fresh_svm();
    let ctx = setup_attestation_ctx(&mut svm);

    let wrong_governor = SigningKey::generate(&mut OsRng);
    let new_enclave = SigningKey::generate(&mut OsRng);
    let new_enclave_pk = Pubkey::new_from_array(new_enclave.verifying_key().to_bytes());
    let current_slot = svm.get_sysvar::<solana_clock::Clock>().slot;
    let expiry_slot = current_slot + 100;

    let attestation_msg = build_attestation_message(
        &solora::id(),
        &ctx.wallet_pda,
        &new_enclave_pk,
        &ctx.measurement_hash,
        current_slot,
        expiry_slot,
        0,
    );
    let tx = build_register_enclave_v2_tx(
        &svm,
        &ctx.payer,
        ctx.wallet_pda,
        ctx.registry,
        &wrong_governor,
        &attestation_msg,
    );

    let err = svm
        .send_transaction(tx)
        .expect_err("wrong governor signature should be rejected");
    let logs = format!("{:?}", err);
    assert!(
        logs.contains("AttestationGovernorMismatch") || logs.contains("Custom("),
        "expected AttestationGovernorMismatch: {}",
        logs
    );
}
