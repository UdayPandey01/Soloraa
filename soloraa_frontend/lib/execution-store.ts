"use client";

import { create } from "zustand";

export type StageState = "idle" | "active" | "ok" | "rejected";

export type StageId =
    | "intent"
    | "policy"
    | "oracle"
    | "build"
    | "sign"
    | "broadcast"
    | "verify";

/**
 * High-level run state.
 *
 * - idle:    no run has been started.
 * - running: the agent loop is alive and ticking off cycles.
 * - stopped: the user pressed Stop. The pipeline halts but the receipts
 *            collected so far stay on screen.
 *
 * Note: there is intentionally no "completed" mode. A real autonomous agent
 * doesn't have a terminal "done" state — it runs until the user stops it.
 */
export type ExecutionMode = "idle" | "running" | "stopped";

export interface ExecutionEvent {
    id: string;
    ts: number;
    stage: StageId;
    title: string;
    detail?: string;
    code?: string;
    rejected?: boolean;
    txSignature?: string;
    explorerUrl?: string;
}

export interface ExecutionRun {
    walletPda: string;
    agentId: string;
    stages: Record<StageId, StageState>;
    events: ExecutionEvent[];
    /** Signature of the most recent successful leg. Drives the explorer link
     *  and the replay-attack demo (which reuses these bytes). */
    lastTxSignature?: string;
    /** Cosmetic rejection (e.g. replay-attack demo). Does NOT end the run. */
    lastRejection?: { code: number; name: string; description: string };
    /** Bumped on every confirmed leg, mirroring the on-chain nonce. */
    walletNonce: number;
    /** Count of confirmed broadcasts this run. */
    legsConfirmed: number;
    /** Running total of notional broadcast through this run, in USDC. */
    cumulativeNotionalUsdc: number;
    mode: ExecutionMode;
}

interface ExecutionState {
    run: ExecutionRun | null;
    start(opts: { walletPda: string; agentId: string }): void;
    appendEvent(event: ExecutionEvent): void;
    setStage(stage: StageId, state: StageState): void;
    resetStages(): void;
    recordSuccess(opts: { txSignature: string; notionalUsdc: number }): void;
    markRejection(rejection: {
        code: number;
        name: string;
        description: string;
    }): void;
    stop(): void;
    reset(): void;
}

const emptyStages: Record<StageId, StageState> = {
    intent: "idle",
    policy: "idle",
    oracle: "idle",
    build: "idle",
    sign: "idle",
    broadcast: "idle",
    verify: "idle",
};

export const useExecution = create<ExecutionState>((set) => ({
    run: null,
    start: ({ walletPda, agentId }) =>
        set({
            run: {
                walletPda,
                agentId,
                stages: { ...emptyStages },
                events: [],
                walletNonce: 0,
                legsConfirmed: 0,
                cumulativeNotionalUsdc: 0,
                mode: "running",
            },
        }),
    appendEvent: (event) =>
        set((s) => {
            if (!s.run) return s;
            return { run: { ...s.run, events: [...s.run.events, event] } };
        }),
    setStage: (stage, stageState) =>
        set((s) => {
            if (!s.run) return s;
            return {
                run: {
                    ...s.run,
                    stages: { ...s.run.stages, [stage]: stageState },
                },
            };
        }),
    resetStages: () =>
        set((s) => {
            if (!s.run) return s;
            return { run: { ...s.run, stages: { ...emptyStages } } };
        }),
    recordSuccess: ({ txSignature, notionalUsdc }) =>
        set((s) => {
            if (!s.run) return s;
            return {
                run: {
                    ...s.run,
                    lastTxSignature: txSignature,
                    walletNonce: s.run.walletNonce + 1,
                    legsConfirmed: s.run.legsConfirmed + 1,
                    cumulativeNotionalUsdc:
                        s.run.cumulativeNotionalUsdc + notionalUsdc,
                },
            };
        }),
    markRejection: (rejection) =>
        set((s) => {
            if (!s.run) return s;
            return { run: { ...s.run, lastRejection: rejection } };
        }),
    stop: () =>
        set((s) => {
            if (!s.run) return s;
            return {
                run: {
                    ...s.run,
                    mode: "stopped",
                    stages: { ...emptyStages },
                },
            };
        }),
    reset: () => set({ run: null }),
}));
