

use crate::error::{EnclaveError, EnclaveResult};
use crate::intent::{
    arbitrary_cpi_payload_hash, build_intent_message, transfer_payload_hash, AccountMetaFlags,
    IntentKind, IntentMessageInputs, INTENT_MSG_LEN,
};
use crate::pyth::{verify_accumulator_update, PythHermesClient, VerifiedPrice};
use crate::solana_rpc::SolanaRpc;
use crate::solora_wallet::SoloraWallet;
use crate::wormhole::GuardianSet;

#[derive(Debug, Clone)]
pub struct SignedIntent {
    pub message: [u8; INTENT_MSG_LEN],
    pub signature: [u8; 64],
    pub pubkey: [u8; 32],
}

pub struct DecisionContext<'a> {
    pub program_id: [u8; 32],
    pub wallet_pda_base58: &'a str,
    pub wallet_pda_bytes: [u8; 32],
    pub expiry_slot: u64,
}

pub struct TransferIntentRequest<'a> {
    pub ctx: DecisionContext<'a>,
    pub destination: [u8; 32],
    pub amount_lamports: u64,
}

pub struct TradeCpiIntentRequest<'a> {
    pub ctx: DecisionContext<'a>,
    pub target_program: [u8; 32],
    pub instruction_data: &'a [u8],
    pub account_metas: &'a [(&'a [u8; 32], AccountMetaFlags)],
    pub side_is_buy: bool,
    pub trade_size_usdc: u64,
    pub limit_price_e8: i64,
    pub expected_slippage_bps: u16,
    pub pyth_feed_id_hex: &'a str,
}

pub struct PolicyEngine<'a> {
    pub rpc: &'a (dyn SolanaRpc + 'a),
    pub hermes: &'a (dyn PythHermesClient + 'a),
    pub guardians: &'a GuardianSet,
}

impl<'a> PolicyEngine<'a> {
    pub async fn decide_transfer<F>(
        &self,
        req: TransferIntentRequest<'a>,
        sign: F,
    ) -> EnclaveResult<SignedIntent>
    where
        F: FnOnce(&[u8; INTENT_MSG_LEN]) -> ([u8; 64], [u8; 32]),
    {
        let wallet_data = self
            .rpc
            .get_account_data(req.ctx.wallet_pda_base58)
            .await?
            .ok_or_else(|| EnclaveError::Rpc("wallet PDA does not exist".into()))?;
        let wallet = SoloraWallet::from_account_data(&wallet_data)?;
        if !wallet.is_active_bool() {
            return Err(EnclaveError::WalletPaused);
        }
        // For a pure transfer there's no oracle stage, but we still respect



        let (bh_slot, recent_blockhash) = self.rpc.get_most_recent_slot_hash().await?;
        let payload_hash = transfer_payload_hash(&req.destination, req.amount_lamports);

        let message = build_intent_message(IntentMessageInputs {
            program_id: &req.ctx.program_id,
            wallet_pda: &req.ctx.wallet_pda_bytes,
            nonce: wallet.nonce,
            expiry_slot: req.ctx.expiry_slot,
            recent_blockhash: &recent_blockhash,
            blockhash_slot: bh_slot,
            kind: IntentKind::Transfer,
            payload_hash: &payload_hash,
        });

        let (signature, pubkey) = sign(&message);
        Ok(SignedIntent {
            message,
            signature,
            pubkey,
        })
    }

    pub async fn decide_trade_cpi<F>(
        &self,
        req: TradeCpiIntentRequest<'a>,
        sign: F,
    ) -> EnclaveResult<SignedIntent>
    where
        F: FnOnce(&[u8; INTENT_MSG_LEN]) -> ([u8; 64], [u8; 32]),
    {
        let wallet_data = self
            .rpc
            .get_account_data(req.ctx.wallet_pda_base58)
            .await?
            .ok_or_else(|| EnclaveError::Rpc("wallet PDA does not exist".into()))?;
        let wallet = SoloraWallet::from_account_data(&wallet_data)?;
        if !wallet.is_active_bool() {
            return Err(EnclaveError::WalletPaused);
        }

        if req.trade_size_usdc > wallet.policy.max_trade_size_usdc {
            return Err(EnclaveError::PolicyTradeSizeExceeded {
                trade: req.trade_size_usdc,
                max: wallet.policy.max_trade_size_usdc,
            });
        }
        if req.expected_slippage_bps > wallet.policy.max_slippage_bps {
            return Err(EnclaveError::PolicySlippageExceedsPolicy {
                expected: req.expected_slippage_bps,
                max: wallet.policy.max_slippage_bps,
            });
        }
        if !wallet.policy.contains(&req.target_program) {
            return Err(EnclaveError::TargetNotAllowed {
                target: bs58::encode(req.target_program).into_string(),
            });
        }

        // Oracle stage: verify Pyth update via Wormhole guardians.
        let bytes = self
            .hermes
            .fetch_latest_update(req.pyth_feed_id_hex)
            .await?;
        let price = verify_accumulator_update(&bytes, req.pyth_feed_id_hex, self.guardians)?;

        let exec_price = expected_execution_price_e8(price, req.side_is_buy)?;
        let slippage_bps = compute_slippage_bps(req.limit_price_e8, exec_price)?;
        if slippage_bps > wallet.policy.max_slippage_bps {
            return Err(EnclaveError::SlippageExceedsPolicy {
                actual: slippage_bps,
                ceiling: wallet.policy.max_slippage_bps,
            });
        }
        if slippage_bps > req.expected_slippage_bps {
            return Err(EnclaveError::SlippageExceedsIntent {
                actual: slippage_bps,
                ceiling: req.expected_slippage_bps,
            });
        }

        let (bh_slot, recent_blockhash) = self.rpc.get_most_recent_slot_hash().await?;
        let payload_hash = arbitrary_cpi_payload_hash(
            &req.target_program,
            req.instruction_data,
            req.account_metas,
        );

        let message = build_intent_message(IntentMessageInputs {
            program_id: &req.ctx.program_id,
            wallet_pda: &req.ctx.wallet_pda_bytes,
            nonce: wallet.nonce,
            expiry_slot: req.ctx.expiry_slot,
            recent_blockhash: &recent_blockhash,
            blockhash_slot: bh_slot,
            kind: IntentKind::ArbitraryCpi,
            payload_hash: &payload_hash,
        });

        let (signature, pubkey) = sign(&message);
        Ok(SignedIntent {
            message,
            signature,
            pubkey,
        })
    }
}

/// Worst-case execution price under buy/sell direction. Buy adds 1×conf;
/// sell subtracts 1×conf. Same convention as the parked Phala enclave.
fn expected_execution_price_e8(price: VerifiedPrice, side_is_buy: bool) -> EnclaveResult<i64> {
    let conf = i64::try_from(price.conf_e8).map_err(|_| EnclaveError::PriceMath)?;
    if side_is_buy {
        price
            .price_e8
            .checked_add(conf)
            .ok_or(EnclaveError::PriceMath)
    } else {
        price
            .price_e8
            .checked_sub(conf)
            .ok_or(EnclaveError::PriceMath)
    }
}

fn compute_slippage_bps(limit_e8: i64, exec_e8: i64) -> EnclaveResult<u16> {
    if limit_e8 <= 0 || exec_e8 <= 0 {
        return Err(EnclaveError::PriceMath);
    }
    let limit = i128::from(limit_e8);
    let exec = i128::from(exec_e8);
    let diff = if exec >= limit {
        exec - limit
    } else {
        limit - exec
    };
    let bps = diff
        .checked_mul(10_000)
        .ok_or(EnclaveError::PriceMath)?
        .checked_div(limit)
        .ok_or(EnclaveError::PriceMath)?;
    u16::try_from(bps).map_err(|_| EnclaveError::PriceMath)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slippage_zero_when_match() {
        assert_eq!(compute_slippage_bps(100_00000000, 100_00000000).unwrap(), 0);
    }

    #[test]
    fn slippage_one_percent() {
        assert_eq!(
            compute_slippage_bps(100_00000000, 101_00000000).unwrap(),
            100
        );
    }

    #[test]
    fn slippage_rejects_negative() {
        assert!(compute_slippage_bps(0, 100_00000000).is_err());
    }
}
