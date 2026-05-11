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

export interface ExecutionEvent {
    id: string;
    ts: number;
    stage: StageId;
    title: string;
    /** Optional structured detail rendered in mono. */
    detail?: string;
    /** Optional code/hash to display with copy affordance. */
    code?: string;
    /** Marks an explicit rejection moment (e.g. replay attempt). */
    rejected?: boolean;
    /** Devnet tx signature for an event tied to a real on-chain action. */
    txSignature?: string;
    /** Pre-built explorer URL for the signature above. */
    explorerUrl?: string;
}

export interface ExecutionRun {
    /** Wallet + agent context for the run. */
    walletPda: string;
    agentId: string;
    /** Map of stage -> state, drives the pipeline visualisation. */
    stages: Record<StageId, StageState>;
    /** Ordered event log. */
    events: ExecutionEvent[];
    /** Final tx signature when broadcast lands; undefined while running. */
    txSignature?: string;
    /** Set when an on-chain rejection fires (replay etc.). */
    rejection?: { code: number; name: string; description: string };
    /** Anchor program nonce after success. Drives replay-demo state. */
    walletNonce: number;
    running: boolean;
}

interface ExecutionState {
    run: ExecutionRun | null;
    start(opts: { walletPda: string; agentId: string }): void;
    appendEvent(event: ExecutionEvent): void;
    setStage(stage: StageId, state: StageState): void;
    succeed(txSignature: string): void;
    reject(rejection: { code: number; name: string; description: string }): void;
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
                running: true,
            },
        }),
    appendEvent: (event) =>
        set((s) => {
            if (!s.run) return s;
            return {
                run: { ...s.run, events: [...s.run.events, event] },
            };
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
    succeed: (txSignature) =>
        set((s) => {
            if (!s.run) return s;
            return {
                run: {
                    ...s.run,
                    txSignature,
                    running: false,
                    walletNonce: s.run.walletNonce + 1,
                },
            };
        }),
    reject: (rejection) =>
        set((s) => {
            if (!s.run) return s;
            return {
                run: { ...s.run, rejection, running: false },
            };
        }),
    reset: () => set({ run: null }),
}));
