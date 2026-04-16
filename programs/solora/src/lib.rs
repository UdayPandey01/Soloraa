pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("DfPLBwWW72YKYt81eVUznE1amapTtXroFGTdGqHo1Ttf");

#[program]
pub mod solora {
    use super::*;

    pub fn initialize_wallet(
        ctx: Context<InitializeWallet>,
        max_trade_size_usdc: u64,
        max_slippage_bps: u16,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.solora_wallet;
        wallet.authority = ctx.accounts.authority.key();
        wallet.enclave_signer = Pubkey::default();
        wallet.is_active = true;
        wallet.policy = Policy {
            max_trade_size_usdc,
            max_slippage_bps,
        };

        msg!("Solora Wallet Initialized for Authority: {}", wallet.authority);
        msg!("AI Policy Enforced - Max Trade: ${}, Max Slippage: {} bps", max_trade_size_usdc, max_slippage_bps);

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
        space = 8 + 32 + 32 + 1 + 8 + 2 
    )]
    pub solora_wallet: Account<'info, SoloraWallet>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}