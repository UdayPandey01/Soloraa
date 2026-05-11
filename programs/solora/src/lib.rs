pub mod attest;
pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod verify;

use anchor_lang::prelude::*;
use solana_sdk_ids::sysvar::instructions::ID as IX_SYSVAR_ID;
use solana_sdk_ids::sysvar::slot_hashes::ID as SLOT_HASHES_ID;
use solana_sha256_hasher::hashv;

pub use constants::*;
pub use instructions::*;
pub use state::*;

use crate::attest::verify_attestation_proof;
use crate::error::ErrorCode;
use crate::verify::verify_enclave_intent;

declare_id!("DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf");

#[program]
pub mod solora {
    use super::*;

    pub fn initialize_wallet(
        ctx: Context<InitializeWallet>,
        max_trade_size_usdc: u64,
        max_slippage_bps: u16,
        dev_enclave_pubkey: Pubkey,
    ) -> Result<()> {
        let mut wallet = ctx.accounts.solora_wallet.load_init()?;

        wallet.authority = ctx.accounts.authority.key();
        wallet.enclave_signer = dev_enclave_pubkey;
        wallet.set_active(true);
        wallet.policy.max_trade_size_usdc = max_trade_size_usdc;
        wallet.policy.max_slippage_bps = max_slippage_bps;
        // allowed_programs / allowed_count / nonce / unlock_timestamp / _padding
        // are zero-initialized by Anchor's `init` — leave as is.

        msg!(
            "Solora Wallet Initialized for Authority: {}",
            wallet.authority
        );
        msg!(
            "AI Policy Enforced - Max Trade: ${}, Max Slippage: {} bps",
            max_trade_size_usdc,
            max_slippage_bps
        );

        Ok(())
    }

    pub fn execute_transfer(ctx: Context<ExecuteTransfer>, amount: u64) -> Result<()> {
        let wallet_key = ctx.accounts.solora_wallet.key();

        // Snapshot the read-only fields we need, then drop the borrow before verify.
        let (expected_signer, expected_nonce) = {
            let wallet = ctx.accounts.solora_wallet.load()?;
            require!(wallet.is_active != 0, ErrorCode::WalletPaused);
            (wallet.enclave_signer, wallet.nonce)
        };

        let payload_hash = transfer_payload_hash(&ctx.accounts.destination.key(), amount);

        verify_enclave_intent(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.slot_hashes_sysvar,
            ctx.program_id,
            &wallet_key,
            &expected_signer,
            IntentKind::Transfer,
            &payload_hash,
            expected_nonce,
            Clock::get()?.slot,
        )?;

        let wallet_info = ctx.accounts.solora_wallet.to_account_info();
        let wallet_balance = wallet_info.lamports();
        let rent_exempt_min = Rent::get()?.minimum_balance(SoloraWallet::SPACE);
        require!(
            wallet_balance
                .checked_sub(amount)
                .map_or(false, |remaining| remaining >= rent_exempt_min),
            ErrorCode::InsufficientWalletBalance
        );

        {
            let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
            wallet.nonce = wallet
                .nonce
                .checked_add(1)
                .ok_or(error!(ErrorCode::NonceOverflow))?;
        }

        wallet_info.sub_lamports(amount)?;
        ctx.accounts.destination.add_lamports(amount)?;

        msg!(
            "AI Intent Executed: Transferred {} lamports (nonce {} -> {})",
            amount,
            expected_nonce,
            expected_nonce + 1
        );
        Ok(())
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        new_max_trade_size: u64,
        new_max_slippage: u16,
    ) -> Result<()> {
        let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
        wallet.policy.max_trade_size_usdc = new_max_trade_size;
        wallet.policy.max_slippage_bps = new_max_slippage;

        msg!(
            "Solora Policy Updated -> Max Trade: ${}, Max Slippage: {} bps",
            new_max_trade_size,
            new_max_slippage
        );
        Ok(())
    }

    pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()> {
        let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
        let now_active = wallet.is_active == 0;
        wallet.set_active(now_active);

        if now_active {
            msg!("Solora Wallet UNPAUSED. AI Execution Resumed.");
        } else {
            msg!("EMERGENCY: Solora Wallet PAUSED. All AI Execution Blocked.");
        }

        Ok(())
    }

    pub fn register_enclave(
        ctx: Context<RegisterEnclave>,
        verified_enclave_pubkey: Pubkey,
    ) -> Result<()> {
        let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
        wallet.enclave_signer = verified_enclave_pubkey;
        wallet.nonce = 0;

        msg!(
            "Enclave attestation accepted. New Enclave Signer: {} (nonce reset to 0)",
            verified_enclave_pubkey
        );
        Ok(())
    }

    pub fn add_allowed_program(
        ctx: Context<ManageAllowlist>,
        target_program: Pubkey,
    ) -> Result<()> {
        require!(
            target_program != *ctx.program_id,
            ErrorCode::SelfRoutingDetected
        );

        let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
        require!(
            !wallet.policy.contains(&target_program),
            ErrorCode::DuplicateAllowedProgram
        );

        let count = wallet.policy.allowed_count as usize;
        require!(count < MAX_ALLOWED_PROGRAMS, ErrorCode::AllowlistFull);

        wallet.policy.allowed_programs[count] = target_program;
        wallet.policy.allowed_count = (count + 1) as u8;

        msg!(
            "CPI allowlist: added {} (count {} -> {})",
            target_program,
            count,
            count + 1
        );
        Ok(())
    }

    pub fn remove_allowed_program(
        ctx: Context<ManageAllowlist>,
        target_program: Pubkey,
    ) -> Result<()> {
        let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
        let count = wallet.policy.allowed_count as usize;
        let pos = wallet.policy.allowed_programs[..count]
            .iter()
            .position(|p| p == &target_program)
            .ok_or(error!(ErrorCode::AllowedProgramNotFound))?;

        wallet.policy.allowed_programs.swap(pos, count - 1);
        wallet.policy.allowed_programs[count - 1] = Pubkey::default();
        wallet.policy.allowed_count = (count - 1) as u8;

        msg!(
            "CPI allowlist: removed {} (count {} -> {})",
            target_program,
            count,
            count - 1
        );
        Ok(())
    }

    pub fn execute_arbitrary_cpi(
        ctx: Context<ExecuteArbitrary>,
        target_program: Pubkey,
        instruction_data: Vec<u8>,
    ) -> Result<()> {
        require!(
            ctx.remaining_accounts.len() <= MAX_CPI_REMAINING_ACCOUNTS,
            ErrorCode::TooManyCpiAccounts
        );
        require!(
            instruction_data.len() <= MAX_CPI_INSTRUCTION_DATA_LEN,
            ErrorCode::CpiInstructionDataTooLarge
        );
        require!(
            target_program != *ctx.program_id,
            ErrorCode::SelfRoutingDetected
        );

        let wallet_key = ctx.accounts.solora_wallet.key();

        // Single zero-copy load: pause check + allowlist + signer/nonce snapshot.
        let (expected_signer, expected_nonce, authority_key) = {
            let wallet = ctx.accounts.solora_wallet.load()?;
            require!(wallet.is_active != 0, ErrorCode::WalletPaused);
            require!(
                wallet.policy.contains(&target_program),
                ErrorCode::TargetProgramNotAllowed
            );
            (wallet.enclave_signer, wallet.nonce, wallet.authority)
        };

        let payload_hash =
            arbitrary_cpi_payload_hash(&target_program, &instruction_data, ctx.remaining_accounts);

        verify_enclave_intent(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.slot_hashes_sysvar,
            ctx.program_id,
            &wallet_key,
            &expected_signer,
            IntentKind::ArbitraryCpi,
            &payload_hash,
            expected_nonce,
            Clock::get()?.slot,
        )?;

        {
            let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
            wallet.nonce = wallet
                .nonce
                .checked_add(1)
                .ok_or(error!(ErrorCode::NonceOverflow))?;
        }

        let bump = ctx.bumps.solora_wallet;
        let signer_seeds: &[&[&[u8]]] = &[&[b"solora", authority_key.as_ref(), &[bump]]];

        let mut account_metas = Vec::with_capacity(ctx.remaining_accounts.len());
        let mut account_infos = Vec::with_capacity(ctx.remaining_accounts.len());

        for account in ctx.remaining_accounts.iter() {
            let meta = if account.is_writable {
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    account.key(),
                    account.is_signer,
                )
            } else {
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    account.key(),
                    account.is_signer,
                )
            };
            account_metas.push(meta);
            account_infos.push(account.clone());
        }

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: target_program,
            accounts: account_metas,
            data: instruction_data,
        };

        anchor_lang::solana_program::program::invoke_signed(&ix, &account_infos, signer_seeds)?;

        msg!(
            "AI Arbitrary Intent Executed via CPI (nonce {} -> {}).",
            expected_nonce,
            expected_nonce + 1
        );
        Ok(())
    }

    pub fn initiate_timelock(ctx: Context<EscapeHatch>) -> Result<()> {
        let clock = Clock::get()?;
        let unlock = clock.unix_timestamp + 86400;

        let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
        wallet.set_active(false);
        wallet.unlock_timestamp = unlock;

        msg!("ESCAPE HATCH INITIATED. Funds unlock at {}", unlock);
        Ok(())
    }

    // -------------------------------------------------------------------
    // Measurement registry (governance-controlled enclave allowlist)
    // -------------------------------------------------------------------

    pub fn init_measurement_registry(ctx: Context<InitMeasurementRegistry>) -> Result<()> {
        let mut reg = ctx.accounts.registry.load_init()?;
        reg.governor = ctx.accounts.governor.key();
        // measurements / count / _padding zero-initialized by Anchor.
        msg!(
            "Measurement registry initialized. Governor: {}",
            reg.governor
        );
        Ok(())
    }

    pub fn add_measurement(
        ctx: Context<ManageRegistry>,
        pcr_hash: [u8; 32],
        label: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let mut reg = ctx.accounts.registry.load_mut()?;
        require_keys_eq!(
            reg.governor,
            ctx.accounts.governor.key(),
            ErrorCode::UnauthorizedGovernor
        );

        if reg.find_any(&pcr_hash).is_some() {
            return Err(error!(ErrorCode::DuplicateMeasurement));
        }
        let count = reg.count as usize;
        require!(count < MAX_MEASUREMENTS, ErrorCode::MeasurementRegistryFull);
        reg.measurements[count] = MeasurementEntry {
            pcr_hash,
            label,
            status: MEASUREMENT_STATUS_ACTIVE,
            _padding: [0; 7],
            added_slot: clock.slot,
        };
        reg.count = (count + 1) as u8;

        msg!(
            "Measurement added (slot {}, count {} -> {})",
            clock.slot,
            count,
            count + 1
        );
        Ok(())
    }

    pub fn revoke_measurement(ctx: Context<ManageRegistry>, pcr_hash: [u8; 32]) -> Result<()> {
        let mut reg = ctx.accounts.registry.load_mut()?;
        require_keys_eq!(
            reg.governor,
            ctx.accounts.governor.key(),
            ErrorCode::UnauthorizedGovernor
        );

        let pos = reg
            .find_any(&pcr_hash)
            .ok_or(error!(ErrorCode::MeasurementNotFound))?;
        reg.measurements[pos].status = MEASUREMENT_STATUS_REVOKED;
        msg!("Measurement revoked at index {}", pos);
        Ok(())
    }

    pub fn transfer_governor(ctx: Context<ManageRegistry>, new_governor: Pubkey) -> Result<()> {
        let mut reg = ctx.accounts.registry.load_mut()?;
        require_keys_eq!(
            reg.governor,
            ctx.accounts.governor.key(),
            ErrorCode::UnauthorizedGovernor
        );
        reg.governor = new_governor;
        msg!("Governor transferred to {}", new_governor);
        Ok(())
    }

    // -------------------------------------------------------------------
    // Attested enclave-signer rotation
    // -------------------------------------------------------------------

    /// Rotate the wallet's enclave_signer to a key that has been attested by
    /// the off-chain verifier and signed by the registry governor. Bumps
    /// wallet.nonce on success, invalidating any in-flight intents from the
    /// previous enclave.
    pub fn register_enclave_v2(ctx: Context<RegisterEnclaveV2>) -> Result<()> {
        let wallet_key = ctx.accounts.solora_wallet.key();

        let expected_nonce = {
            let wallet = ctx.accounts.solora_wallet.load()?;
            wallet.nonce
        };
        let governor = {
            let reg = ctx.accounts.registry.load()?;
            reg.governor
        };

        let fields = verify_attestation_proof(
            &ctx.accounts.instructions_sysvar,
            ctx.program_id,
            &wallet_key,
            &governor,
            expected_nonce,
            Clock::get()?.slot,
        )?;

        // Registry membership + status check.
        {
            let reg = ctx.accounts.registry.load()?;
            let entry = reg
                .measurements_slice()
                .iter()
                .find(|m| m.pcr_hash == fields.measurement_hash)
                .ok_or(error!(ErrorCode::AttestationMeasurementMismatch))?;
            require!(entry.is_active(), ErrorCode::MeasurementRevoked);
        }

        let mut wallet = ctx.accounts.solora_wallet.load_mut()?;
        wallet.enclave_signer = Pubkey::new_from_array(fields.new_enclave_pubkey);
        wallet.nonce = wallet
            .nonce
            .checked_add(1)
            .ok_or(error!(ErrorCode::NonceOverflow))?;

        msg!(
            "Attested enclave registered. Signer: {} (nonce {} -> {})",
            wallet.enclave_signer,
            expected_nonce,
            expected_nonce + 1
        );
        Ok(())
    }

    pub fn execute_escape(ctx: Context<EscapeHatch>) -> Result<()> {
        let clock = Clock::get()?;

        let unlock_ts = {
            let wallet = ctx.accounts.solora_wallet.load()?;
            wallet.unlock_timestamp
        };
        require!(unlock_ts > 0, ErrorCode::NoTimelock);
        require!(clock.unix_timestamp >= unlock_ts, ErrorCode::TimelockActive);

        let wallet_info = ctx.accounts.solora_wallet.to_account_info();
        let balance = wallet_info.lamports();
        wallet_info.sub_lamports(balance)?;
        ctx.accounts.authority.add_lamports(balance)?;

        msg!("ESCAPE SUCCESSFUL. {} lamports recovered.", balance);
        Ok(())
    }
}

pub fn transfer_payload_hash(destination: &Pubkey, amount: u64) -> [u8; 32] {
    let kind = [IntentKind::Transfer as u8];
    let amount_le = amount.to_le_bytes();
    hashv(&[&kind, destination.as_ref(), &amount_le]).to_bytes()
}

pub fn arbitrary_cpi_payload_hash(
    target_program: &Pubkey,
    ix_data: &[u8],
    remaining_accounts: &[AccountInfo],
) -> [u8; 32] {
    let kind = [IntentKind::ArbitraryCpi as u8];
    let ix_data_hash = hashv(&[ix_data]).to_bytes();

    let mut accounts_buf = Vec::with_capacity(remaining_accounts.len() * 34);
    for acct in remaining_accounts.iter() {
        accounts_buf.extend_from_slice(acct.key.as_ref());
        accounts_buf.push(if acct.is_signer { 1 } else { 0 });
        accounts_buf.push(if acct.is_writable { 1 } else { 0 });
    }
    let accounts_hash = hashv(&[&accounts_buf]).to_bytes();

    hashv(&[
        &kind,
        target_program.as_ref(),
        &ix_data_hash,
        &accounts_hash,
    ])
    .to_bytes()
}

#[derive(Accounts)]
pub struct InitializeWallet<'info> {
    #[account(
        init,
        payer = authority,
        space = SoloraWallet::SPACE,
        seeds = [b"solora", authority.key().as_ref()],
        bump
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
    /// PDA-checked via seeds. Pause-check (`is_active`) is enforced inside the
    /// handler because AccountLoader cannot expose fields in account constraints.
    #[account(
        mut,
        seeds = [b"solora", solora_wallet.load()?.authority.as_ref()],
        bump,
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    /// CHECK: Destination is only used as a transfer recipient and is not deserialized.
    /// The signed enclave intent binds (destination, amount) into the payload hash.
    pub destination: UncheckedAccount<'info>,

    /// CHECK: Address is constrained to the canonical instructions sysvar; the verifier
    /// reads the Ed25519Program ix at current_index - 1 via this account.
    #[account(address = IX_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    /// CHECK: Address is constrained to the canonical SlotHashes sysvar; the verifier
    /// binary-searches it to confirm the signed (blockhash, slot) pair is on-chain.
    #[account(address = SLOT_HASHES_ID)]
    pub slot_hashes_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    #[account(
        mut,
        seeds = [b"solora", authority.key().as_ref()],
        bump,
        constraint = solora_wallet.load()?.authority == authority.key() @ ErrorCode::UnauthorizedUser,
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(
        mut,
        seeds = [b"solora", authority.key().as_ref()],
        bump,
        constraint = solora_wallet.load()?.authority == authority.key() @ ErrorCode::UnauthorizedUser,
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterEnclave<'info> {
    #[account(
        mut,
        seeds = [b"solora", authority.key().as_ref()],
        bump,
        constraint = solora_wallet.load()?.authority == authority.key() @ ErrorCode::UnauthorizedUser,
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitMeasurementRegistry<'info> {
    #[account(
        init,
        payer = governor,
        space = MeasurementRegistry::SPACE,
        seeds = [MEASUREMENT_REGISTRY_SEED],
        bump
    )]
    pub registry: AccountLoader<'info, MeasurementRegistry>,

    #[account(mut)]
    pub governor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageRegistry<'info> {
    #[account(
        mut,
        seeds = [MEASUREMENT_REGISTRY_SEED],
        bump
    )]
    pub registry: AccountLoader<'info, MeasurementRegistry>,

    #[account(mut)]
    pub governor: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterEnclaveV2<'info> {
    #[account(
        mut,
        seeds = [b"solora", solora_wallet.load()?.authority.as_ref()],
        bump,
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,

    #[account(
        seeds = [MEASUREMENT_REGISTRY_SEED],
        bump
    )]
    pub registry: AccountLoader<'info, MeasurementRegistry>,

    /// CHECK: Address is constrained to the canonical instructions sysvar.
    #[account(address = IX_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ManageAllowlist<'info> {
    #[account(
        mut,
        seeds = [b"solora", authority.key().as_ref()],
        bump,
        constraint = solora_wallet.load()?.authority == authority.key() @ ErrorCode::UnauthorizedUser,
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteArbitrary<'info> {
    #[account(
        mut,
        seeds = [b"solora", solora_wallet.load()?.authority.as_ref()],
        bump,
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Address is constrained to the canonical instructions sysvar.
    #[account(address = IX_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    /// CHECK: Address is constrained to the canonical SlotHashes sysvar.
    #[account(address = SLOT_HASHES_ID)]
    pub slot_hashes_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct EscapeHatch<'info> {
    #[account(
        mut,
        seeds = [b"solora", authority.key().as_ref()],
        bump,
        constraint = solora_wallet.load()?.authority == authority.key() @ ErrorCode::UnauthorizedUser,
    )]
    pub solora_wallet: AccountLoader<'info, SoloraWallet>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
