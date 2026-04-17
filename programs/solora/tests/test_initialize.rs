use {
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

#[test]
fn test_initialize() {
    let program_id = solora::id();
    let payer = Keypair::new();
    let enclave_signer = Keypair::new();
    let (solora_wallet, _bump) =
        Pubkey::find_program_address(&[b"solora", payer.pubkey().as_ref()], &program_id);
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/solora.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let instruction = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::InitializeWallet {
            max_trade_size_usdc: 100_000,
            max_slippage_bps: 50,
            dev_enclave_pubkey: enclave_signer.pubkey(),
        }
        .data(),
        solora::accounts::InitializeWallet {
            solora_wallet,
            authority: payer.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}

#[test]
fn test_update_policy_and_toggle_pause() {
    let program_id = solora::id();
    let payer = Keypair::new();
    let enclave_signer = Keypair::new();
    let (solora_wallet, _bump) =
        Pubkey::find_program_address(&[b"solora", payer.pubkey().as_ref()], &program_id);

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/solora.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let init_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::InitializeWallet {
            max_trade_size_usdc: 100_000,
            max_slippage_bps: 50,
            dev_enclave_pubkey: enclave_signer.pubkey(),
        }
        .data(),
        solora::accounts::InitializeWallet {
            solora_wallet,
            authority: payer.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );
    let init_msg =
        Message::new_with_blockhash(&[init_ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let init_tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(init_msg), &[&payer]).unwrap();
    assert!(svm.send_transaction(init_tx).is_ok());

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

#[test]
fn test_execute_transfer_rejects_wrong_enclave_signer() {
    let program_id = solora::id();
    let payer = Keypair::new();
    let enclave_signer = Keypair::new();
    let bad_enclave = Keypair::new();
    let destination = Keypair::new();
    let (solora_wallet, _bump) =
        Pubkey::find_program_address(&[b"solora", payer.pubkey().as_ref()], &program_id);

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/solora.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&destination.pubkey(), 1_000_000).unwrap();

    let init_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::InitializeWallet {
            max_trade_size_usdc: 100_000,
            max_slippage_bps: 50,
            dev_enclave_pubkey: enclave_signer.pubkey(),
        }
        .data(),
        solora::accounts::InitializeWallet {
            solora_wallet,
            authority: payer.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );
    let init_msg =
        Message::new_with_blockhash(&[init_ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let init_tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(init_msg), &[&payer]).unwrap();
    assert!(svm.send_transaction(init_tx).is_ok());

    let transfer_ix = Instruction::new_with_bytes(
        program_id,
        &solora::instruction::ExecuteTransfer { amount: 1 }.data(),
        solora::accounts::ExecuteTransfer {
            solora_wallet,
            enclave_signer: bad_enclave.pubkey(),
            destination: destination.pubkey(),
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    );
    let transfer_msg = Message::new_with_blockhash(
        &[transfer_ix],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let transfer_tx = VersionedTransaction::try_new(
        VersionedMessage::Legacy(transfer_msg),
        &[&payer, &bad_enclave],
    )
    .unwrap();

    let res = svm.send_transaction(transfer_tx);
    assert!(res.is_err());
}
