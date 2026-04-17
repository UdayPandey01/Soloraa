use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The wallet is currently paused by the user.")]
    WalletPaused,
    #[msg("Transaction signed by an unauthorized enclave.")]
    UnauthorizedEnclave,
    #[msg("Only the wallet authority can perform this action.")]
    UnauthorizedUser,
    #[msg("Self-routing CPI into the Solora program is not allowed.")]
    SelfRoutingDetected,
    #[msg("No active timelock is set.")]
    NoTimelock,
    #[msg("Escape timelock is still active.")]
    TimelockActive,
}
