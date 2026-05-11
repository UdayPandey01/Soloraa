param(
    [string]$Ledger = ".localnet",
    [int]$RpcPort = 8899
)

$ErrorActionPreference = "Stop"

solana-test-validator --reset --ledger $Ledger --rpc-port $RpcPort --bind-address 0.0.0.0
