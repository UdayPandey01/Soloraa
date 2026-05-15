"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface PortfolioReceipt {
    label: string;
    signature: string;
    explorerUrl: string;
    notionalUsdc: number;
    ts: number;
}

export type PortfolioRunStatus = "running" | "stopped" | "withdrawn";

export interface PortfolioRun {
    id: string;
    walletPubkey: string;
    agentId: string;
    agentName: string;
    delegatedUsdc: number;
    receipts: PortfolioReceipt[];
    startedAt: number;
    completedAt: number;
    status?: PortfolioRunStatus;
}

interface PortfolioState {
    runs: PortfolioRun[];
    addRun(run: PortfolioRun): void;
    upsertRun(run: PortfolioRun): void;
    clearForWallet(walletPubkey: string): void;
    clearAll(): void;
}

export const usePortfolio = create<PortfolioState>()(
    persist(
        (set) => ({
            runs: [],
            addRun: (run) =>
                set((s) => ({
                    runs: [run, ...s.runs].slice(0, 100),
                })),
            upsertRun: (run) =>
                set((s) => {
                    const idx = s.runs.findIndex((r) => r.id === run.id);
                    if (idx === -1) {
                        return { runs: [run, ...s.runs].slice(0, 100) };
                    }
                    const next = s.runs.slice();
                    next[idx] = run;
                    return { runs: next };
                }),
            clearForWallet: (walletPubkey) =>
                set((s) => ({
                    runs: s.runs.filter((r) => r.walletPubkey !== walletPubkey),
                })),
            clearAll: () => set({ runs: [] }),
        }),
        {
            name: "soloraa-portfolio-v1",
            storage: createJSONStorage(() =>
                typeof window !== "undefined" ? window.localStorage : (undefined as never)
            ),
        }
    )
);

export function runsForWallet(
    runs: PortfolioRun[],
    walletPubkey: string | undefined
): PortfolioRun[] {
    if (!walletPubkey) return [];
    return runs.filter((r) => r.walletPubkey === walletPubkey);
}

export function totalNotional(run: PortfolioRun): number {
    return run.receipts.reduce((acc, r) => acc + r.notionalUsdc, 0);
}
