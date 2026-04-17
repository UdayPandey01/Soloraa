use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The wallet is currently paused by the user.")]
    WalletPaused,
    #[msg("Transaction signed by an unauthorized enclave.")]
    UnauthorizedEnclave,
    #[msg("Only the wallet authority can perform this action.")]
    UnauthorizedUser,
}
