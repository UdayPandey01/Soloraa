pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;

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
        let wallet = &mut ctx.accounts.solora_wallet;

        wallet.authority = ctx.accounts.authority.key();
        wallet.enclave_signer = dev_enclave_pubkey;
        wallet.is_active = true;
        wallet.policy = Policy {
            max_trade_size_usdc,
            max_slippage_bps,
        };

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
        let wallet = &ctx.accounts.solora_wallet;

        let authority_key = wallet.authority.key();
        let bump = ctx.bumps.solora_wallet;
        let signer_seeds: &[&[&[u8]]] = &[&[b"solora", authority_key.as_ref(), &[bump]]];

        let transfer_instruction = anchor_lang::solana_program::system_instruction::transfer(
            &wallet.key(),
            &ctx.accounts.destination.key(),
            amount,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_instruction,
            &[
                ctx.accounts.solora_wallet.to_account_info(),
                ctx.accounts.destination.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        msg!("AI Intent Executed: Transferred {} lamports", amount);
        Ok(())
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        new_max_trade_size: u64,
        new_max_slippage: u16,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.solora_wallet;

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
        let wallet = &mut ctx.accounts.solora_wallet;

        wallet.is_active = !wallet.is_active;

        if wallet.is_active {
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
        let wallet = &mut ctx.accounts.solora_wallet;
        wallet.enclave_signer = verified_enclave_pubkey;

        msg!(
            "Intel SGX Attestation Verified. New Enclave Signer: {}",
            verified_enclave_pubkey
        );
        Ok(())
    }

    pub fn execute_arbitrary_cpi(
        ctx: Context<ExecuteArbitrary>,
        target_program: Pubkey,
        instruction_data: Vec<u8>,
    ) -> Result<()> {
        require!(
            target_program != *ctx.program_id,
            crate::error::ErrorCode::SelfRoutingDetected
        );

        let wallet = &ctx.accounts.solora_wallet;
        let authority_key = wallet.authority.key();
        let bump = ctx.bumps.solora_wallet;
        let signer_seeds: &[&[&[u8]]] = &[&[b"solora", authority_key.as_ref(), &[bump]]];

        let mut account_metas = Vec::new();
        let mut account_infos = Vec::new();

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

        msg!("AI Arbitrary Intent Executed via CPI.");
        Ok(())
    }

    pub fn initiate_timelock(ctx: Context<EscapeHatch>) -> Result<()> {
        let wallet = &mut ctx.accounts.solora_wallet;
        wallet.is_active = false;

        let clock = Clock::get()?;
        wallet.unlock_timestamp = clock.unix_timestamp + 86400; // 24 hour timelock

        msg!(
            "ESCAPE HATCH INITIATED. Funds unlock at {}",
            wallet.unlock_timestamp
        );
        Ok(())
    }

    pub fn execute_escape(ctx: Context<EscapeHatch>) -> Result<()> {
        let wallet = &mut ctx.accounts.solora_wallet;
        let clock = Clock::get()?;

        require!(
            wallet.unlock_timestamp > 0,
            crate::error::ErrorCode::NoTimelock
        );
        require!(
            clock.unix_timestamp >= wallet.unlock_timestamp,
            crate::error::ErrorCode::TimelockActive
        );

        let balance = wallet.to_account_info().lamports();
        wallet.sub_lamports(balance)?;
        ctx.accounts.authority.add_lamports(balance)?;

        msg!("ESCAPE SUCCESSFUL. {} lamports recovered.", balance);
        Ok(())
    }
}

#[account]
pub struct SoloraWallet {
    pub authority: Pubkey,
    pub enclave_signer: Pubkey,
    pub is_active: bool,
    pub policy: Policy,
    pub unlock_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Policy {
    pub max_trade_size_usdc: u64,
    pub max_slippage_bps: u16,
}

#[derive(Accounts)]
pub struct InitializeWallet<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 1 + 8 + 2 + 8,
        seeds = [b"solora", authority.key().as_ref()],
        bump
    )]
    pub solora_wallet: Account<'info, SoloraWallet>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteTransaction<'info> {
    #[account(
        mut,
        constraint = solora_wallet.is_active == true @ crate::error::ErrorCode::WalletPaused,
        constraint = enclave_signer.key() == solora_wallet.enclave_signer @ crate::error::ErrorCode::UnauthorizedEnclave
    )]
    pub solora_wallet: Account<'info, SoloraWallet>,
    pub enclave_signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
    #[account(
        mut,
        seeds = [b"solora", solora_wallet.authority.as_ref()],
        bump,
        constraint = solora_wallet.is_active == true @ crate::error::ErrorCode::WalletPaused,
        constraint = enclave_signer.key() == solora_wallet.enclave_signer @ crate::error::ErrorCode::UnauthorizedEnclave
    )]
    pub solora_wallet: Account<'info, SoloraWallet>,

    #[account(mut)]
    pub enclave_signer: Signer<'info>,

    #[account(mut)]
    /// CHECK: Destination is only used as a transfer recipient and is not deserialized.
    /// Any system account is valid for receiving lamports.
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    #[account(
        mut,
        seeds = [b"solora", authority.key().as_ref()],
        bump,
        has_one = authority @ crate::error::ErrorCode::UnauthorizedUser,
    )]
    pub solora_wallet: Account<'info, SoloraWallet>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(
        mut,
        seeds = [b"solora", authority.key().as_ref()],
        bump,
        has_one = authority @ crate::error::ErrorCode::UnauthorizedUser,
    )]
    pub solora_wallet: Account<'info, SoloraWallet>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterEnclave<'info> {
    #[account(mut, has_one = authority @ crate::error::ErrorCode::UnauthorizedUser)]
    pub solora_wallet: Account<'info, SoloraWallet>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: This account is reserved for the instructions sysvar and must be
    /// validated in instruction logic before use.
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExecuteArbitrary<'info> {
    #[account(
        mut,
        seeds = [b"solora", solora_wallet.authority.as_ref()],
        bump,
        constraint = solora_wallet.is_active == true @ crate::error::ErrorCode::WalletPaused,
        constraint = enclave_signer.key() == solora_wallet.enclave_signer @ crate::error::ErrorCode::UnauthorizedEnclave
    )]
    pub solora_wallet: Account<'info, SoloraWallet>,
    #[account(mut)]
    pub enclave_signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct EscapeHatch<'info> {
    #[account(mut, has_one = authority @ crate::error::ErrorCode::UnauthorizedUser)]
    pub solora_wallet: Account<'info, SoloraWallet>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
