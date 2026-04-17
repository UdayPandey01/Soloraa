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
}

#[account]
pub struct SoloraWallet {
    pub authority: Pubkey,
    pub enclave_signer: Pubkey,
    pub is_active: bool,
    pub policy: Policy,
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
        space = 8 + 32 + 32 + 1 + 8 + 2,
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
