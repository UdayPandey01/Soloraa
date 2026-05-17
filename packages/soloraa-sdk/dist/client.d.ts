import type { ExecutionResult, RelayerHealth, RelayerKeys, SoloraaClientConfig, TransferRequest, VerifyIntentInput, VerifyResult } from "./types.js";
export declare class SoloraaClient {
    private readonly relayerUrl;
    private readonly walletAuthority?;
    private readonly agentId?;
    private readonly fetchImpl;
    constructor(config?: SoloraaClientConfig);
    /**
     * Ask the relayer to ask the enclave to sign a transfer intent, then
     * submit it on chain through the program's `execute_transfer` instruction.
     */
    executeTransfer(req: TransferRequest): Promise<ExecutionResult>;
    /** Liveness check. Returns the relayer's program ID + cluster. */
    health(): Promise<RelayerHealth>;
    /** Returns the relayer's fee-payer pubkey and the live enclave pubkey. */
    keys(): Promise<RelayerKeys>;
    /**
     * Locally re-verify a (message, signature, pubkey) triple. Runs a real
     * Ed25519 check via @noble/ed25519; never trusts the enclave's word.
     *
     * Useful for replay tooling, audit logs, and observability pipelines
     * that want to validate signed bytes off the critical path.
     */
    verifyIntent(input: VerifyIntentInput): Promise<VerifyResult>;
    private verifyEd25519;
}
export declare class SoloraaExecutionError extends Error {
    readonly code: number | undefined;
    readonly errorName: string | undefined;
    readonly docUrl?: string;
    constructor(code: number | undefined, errorName: string | undefined, message: string, docUrl?: string);
}
//# sourceMappingURL=client.d.ts.map