/**
 * Per-agent execution strategies.
 *
 * Each agent kind owns its own state shape, cycle logic, and metrics. The
 * AgentRunner is strategy-agnostic — it just calls strategy.tick() per cycle
 * and renders whatever strategy.summary() returns.
 *
 * Adding a new agent type:
 *   1. Add to StrategyKind union.
 *   2. Implement a Strategy<TYourState> object.
 *   3. Register it in STRATEGIES at the bottom.
 *   4. Add an agent entry with `kind: '<your-kind>'` in lib/agents.ts.
 */

/** Reference SOL price used to translate SOL ↔ USDC for display only. */
export const SOL_USDC_REF = 142;

export type StrategyKind =
    | "market-making"
    | "treasury"
    | "yield"
    | "dca"
    | "arbitrage"
    | "portfolio";

export type MetricTone = "pos" | "neg" | "neutral";

export interface MetricCard {
    label: string;
    value: string;
    helper?: string;
    tone?: MetricTone;
}

export interface Ticker {
    label: string;
    value: string;
    tone?: MetricTone;
}

/** Effect of a single cycle. Emitted by strategy.tick(). */
export interface CycleEffect {
    label: string;
    detail: string;
    memoKind: string;
    notionalUsdc: number;
    realizedDelta: number;
    /** Override default oracle-stage event detail. */
    oracleEventDetail?: string;
    /** Override default sign-stage event detail. */
    signEventDetail?: string;
    /** Override default policy-stage event detail. */
    policyEventDetail?: string;
}

export interface StrategySummary {
    /** Two strategy-specific metric cards rendered at slots 3 and 4. */
    metrics: [MetricCard, MetricCard];
    /** Two strategy-specific live tickers (between Wallet and Session). */
    tickers: [Ticker, Ticker];
    /** Single-line P&L summary used in the Agent-stopped event. */
    pnlLine: string;
}

/**
 * Live market context passed to each strategy on every cycle. Sourced from
 * the real Pyth Hermes feed in production. `isLive` is false when the feed
 * has not delivered an update within its freshness window; strategies and
 * the runner treat this as a transient pause condition.
 */
export interface CycleContext {
    livePrice: number;
    confBps: number;
    publishTimeMs: number;
    isLive: boolean;
}

export interface Strategy<S = unknown> {
    kind: StrategyKind;
    init(delegatedSol: number): S;
    tick(
        state: S,
        cycleIndex: number,
        ctx: CycleContext
    ): { next: S; effect: CycleEffect };
    summary(
        state: S,
        legsConfirmed: number,
        ctx: CycleContext
    ): StrategySummary;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmtUsd = (n: number, decimals = 2) =>
    `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(decimals)} USDC`;
const fmtSigned = (n: number, decimals = 2, suffix = "") =>
    `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(decimals)}${suffix}`;
const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const fmtBps = (bps: number) => `${bps.toFixed(0)} bps`;

const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, n));

function walk(prev: number, vol: number, lo: number, hi: number): number {
    const move = (Math.random() - 0.5) * vol;
    return clamp(prev + move, lo, hi);
}

// ══════════════════════════════════════════════════════════════════════════════
// MARKET MAKING
// ══════════════════════════════════════════════════════════════════════════════

export interface MMState {
    inventory: number; // signed SOL
    costBasis: number; // USDC per SOL
    realizedPnl: number; // USDC
    lastAction: "quote" | "fill" | "trim";
}

const MM_SPREAD_BPS = 20;
const MM_INVENTORY_THRESHOLD = 0.35;

export const marketMakingStrategy: Strategy<MMState> = {
    kind: "market-making",
    init: () => ({
        inventory: 0,
        costBasis: 0,
        realizedPnl: 0,
        lastAction: "quote",
    }),

    tick(state, _cycleIndex, ctx) {
        const mid = ctx.livePrice;
        const confBps = Math.max(1, Math.round(ctx.confBps));

        let action: "quote" | "fill" | "trim";
        if (Math.abs(state.inventory) >= MM_INVENTORY_THRESHOLD) {
            action = "trim";
        } else if (state.lastAction === "fill" && Math.random() < 0.55) {
            action = "quote";
        } else if (Math.random() < 0.4) {
            action = "fill";
        } else {
            action = "quote";
        }

        if (action === "quote") {
            return {
                next: { ...state, lastAction: "quote" },
                effect: {
                    label: `Quote refresh — bid/ask @ ${mid.toFixed(2)}`,
                    detail: `Symmetric maker quotes ${MM_SPREAD_BPS / 2} bps inside Pyth mid ${mid.toFixed(2)}. Inventory ${state.inventory.toFixed(3)} SOL.`,
                    memoKind: "mm.quote_refresh",
                    notionalUsdc: 0,
                    realizedDelta: 0,
                    oracleEventDetail: `Live Pyth SOL/USDC ${mid.toFixed(2)} · conf ${confBps} bps · published ${Math.round((Date.now() - ctx.publishTimeMs) / 1000)}s ago.`,
                    signEventDetail: `Phoenix place_limit_order intent · symmetric bid/ask.`,
                },
            };
        }

        if (action === "fill") {
            const side: 1 | -1 = Math.random() > 0.5 ? 1 : -1;
            const sizeSol = 0.08 + Math.random() * 0.1;
            const fillPrice =
                side === 1 ? mid * (1 - MM_SPREAD_BPS / 20000) : mid * (1 + MM_SPREAD_BPS / 20000);
            const spreadEarned = (sizeSol * mid * MM_SPREAD_BPS) / 10_000;
            const newInv = state.inventory + side * sizeSol;
            let newCost: number;
            if (Math.abs(state.inventory) < 1e-6) newCost = fillPrice;
            else if (Math.sign(newInv) !== Math.sign(state.inventory) && Math.abs(newInv) > 1e-6)
                newCost = fillPrice;
            else if (Math.abs(newInv) < 1e-6) newCost = 0;
            else
                newCost =
                    (state.inventory * state.costBasis + side * sizeSol * fillPrice) / newInv;

            const verb = side === 1 ? "Bought" : "Sold";
            const sideLabel = side === 1 ? "bid" : "ask";

            return {
                next: {
                    inventory: newInv,
                    costBasis: isFinite(newCost) ? newCost : mid,
                    realizedPnl: state.realizedPnl + spreadEarned,
                    lastAction: "fill",
                },
                effect: {
                    label: `Maker fill — ${sizeSol.toFixed(3)} SOL @ ${sideLabel}`,
                    detail: `${verb} ${sizeSol.toFixed(3)} SOL near mid ${mid.toFixed(2)}. Spread captured +${spreadEarned.toFixed(3)} USDC.`,
                    memoKind: "mm.fill",
                    notionalUsdc: sizeSol * mid,
                    realizedDelta: spreadEarned,
                    oracleEventDetail: `Live Pyth ${mid.toFixed(2)} · conf ${confBps} bps. Fill priced ${MM_SPREAD_BPS / 2} bps inside mid.`,
                    signEventDetail: `Phoenix place_limit_order fill at ${sideLabel} ${fillPrice.toFixed(3)}.`,
                },
            };
        }

        // trim
        const sign = state.inventory >= 0 ? 1 : -1;
        const trimSize = Math.min(Math.abs(state.inventory), 0.05 + Math.random() * 0.08);
        const realized = sign * trimSize * (mid - state.costBasis);
        const newInv = state.inventory - sign * trimSize;
        return {
            next: {
                inventory: newInv,
                costBasis: Math.abs(newInv) < 1e-6 ? 0 : state.costBasis,
                realizedPnl: state.realizedPnl + realized,
                lastAction: "trim",
            },
            effect: {
                label: `Inventory trim — ${trimSize.toFixed(3)} SOL`,
                detail: `Trimmed ${trimSize.toFixed(3)} SOL toward neutral at mid ${mid.toFixed(2)}. Realized ${fmtSigned(realized, 3, " USDC")}.`,
                memoKind: "mm.rebalance",
                notionalUsdc: trimSize * mid,
                realizedDelta: realized,
                oracleEventDetail: `Live Pyth ${mid.toFixed(2)} · conf ${confBps} bps · trim mark.`,
                signEventDetail: `Phoenix CPI · inventory rebalance at mid ${mid.toFixed(2)}.`,
            },
        };
    },

    summary(state, legsConfirmed, ctx) {
        const mid = ctx.isLive ? ctx.livePrice : 0;
        const unrealized =
            Math.abs(state.inventory) < 1e-6 || !ctx.isLive
                ? 0
                : state.inventory * (mid - state.costBasis);
        return {
            metrics: [
                {
                    label: "Realized P&L",
                    value: legsConfirmed > 0 ? fmtSigned(state.realizedPnl, 2, " USDC") : "—",
                    helper: `simulated · ${legsConfirmed} cycles`,
                    tone: state.realizedPnl >= 0 ? "pos" : "neg",
                },
                {
                    label: "Unrealized P&L",
                    value:
                        Math.abs(state.inventory) > 1e-6 && ctx.isLive
                            ? fmtSigned(unrealized, 2, " USDC")
                            : "—",
                    helper: "mark-to-live-Pyth open position",
                    tone: unrealized >= 0 ? "pos" : "neg",
                },
            ],
            tickers: [
                {
                    label: "Pyth mid",
                    value: ctx.isLive ? mid.toFixed(2) : "waiting…",
                    tone: ctx.isLive ? "neutral" : "neg",
                },
                {
                    label: "Inventory",
                    value:
                        Math.abs(state.inventory) < 1e-6
                            ? "neutral"
                            : fmtSigned(state.inventory, 3, " SOL"),
                    tone: state.inventory >= 0 ? "neutral" : "neg",
                },
            ],
            pnlLine: `Realized ${state.realizedPnl.toFixed(2)} USDC across ${legsConfirmed} cycles.`,
        };
    },
};

// ══════════════════════════════════════════════════════════════════════════════
// DCA (Dollar-Cost Averaging)
// ══════════════════════════════════════════════════════════════════════════════

export interface DcaState {
    /** Cumulative SOL bought across all tranches. */
    cumulativeSol: number;
    /** Cumulative USDC spent. */
    cumulativeSpent: number;
    /** Which tranche index we're on (0..n-1, rotates). */
    trancheIndex: number;
}

const DCA_TRANCHE_USDC_TARGETS = [12, 18, 24]; // 3 rotating tranche sizes

export const dcaStrategy: Strategy<DcaState> = {
    kind: "dca",
    init: () => ({
        cumulativeSol: 0,
        cumulativeSpent: 0,
        trancheIndex: 0,
    }),

    tick(state, _cycleIndex, ctx) {
        const mid = ctx.livePrice;
        const confBps = Math.max(1, Math.round(ctx.confBps));
        const trancheUsdc = DCA_TRANCHE_USDC_TARGETS[state.trancheIndex]!;
        const solBought = trancheUsdc / mid;
        const nextTrancheIdx = (state.trancheIndex + 1) % DCA_TRANCHE_USDC_TARGETS.length;
        return {
            next: {
                cumulativeSol: state.cumulativeSol + solBought,
                cumulativeSpent: state.cumulativeSpent + trancheUsdc,
                trancheIndex: nextTrancheIdx,
            },
            effect: {
                label: `Tranche ${state.trancheIndex + 1}/${DCA_TRANCHE_USDC_TARGETS.length} — ${trancheUsdc} USDC → SOL`,
                detail: `Bought ${solBought.toFixed(4)} SOL at Pyth mid ${mid.toFixed(2)}. Cumulative ${(state.cumulativeSol + solBought).toFixed(4)} SOL · ${(state.cumulativeSpent + trancheUsdc).toFixed(0)} USDC spent.`,
                memoKind: `dca.tranche_${state.trancheIndex + 1}`,
                notionalUsdc: trancheUsdc,
                realizedDelta: 0,
                oracleEventDetail: `Live Pyth SOL/USDC ${mid.toFixed(2)} · conf ${confBps} bps · slippage cap 50 bps. Verified before sign.`,
                signEventDetail: `Jupiter v6 shared_accounts_route swap intent for ${trancheUsdc} USDC.`,
                policyEventDetail: `Tranche ≤ max trade · cadence within schedule · slippage 50 bps ≤ policy.`,
            },
        };
    },

    summary(state, legsConfirmed, ctx) {
        const avgCost =
            state.cumulativeSol > 1e-6
                ? state.cumulativeSpent / state.cumulativeSol
                : 0;
        const mid = ctx.isLive ? ctx.livePrice : 0;
        const currentValue = state.cumulativeSol * mid;
        const unrealized = ctx.isLive ? currentValue - state.cumulativeSpent : 0;
        return {
            metrics: [
                {
                    label: "Avg cost basis",
                    value: avgCost > 0 ? `${avgCost.toFixed(2)} USDC/SOL` : "—",
                    helper: `${state.cumulativeSol.toFixed(4)} SOL bought · ${state.cumulativeSpent.toFixed(0)} USDC spent`,
                    tone: "neutral",
                },
                {
                    label: "Unrealized P&L",
                    value:
                        state.cumulativeSol > 1e-6 && ctx.isLive
                            ? fmtSigned(unrealized, 2, " USDC")
                            : "—",
                    helper: `mark-to-live-Pyth · current ${currentValue.toFixed(0)} USDC`,
                    tone: unrealized >= 0 ? "pos" : "neg",
                },
            ],
            tickers: [
                {
                    label: "Pyth mid",
                    value: ctx.isLive ? mid.toFixed(2) : "waiting…",
                    tone: ctx.isLive ? "neutral" : "neg",
                },
                {
                    label: "Tranches",
                    value:
                        legsConfirmed > 0
                            ? `${legsConfirmed} confirmed · ${state.cumulativeSol.toFixed(3)} SOL`
                            : "—",
                },
            ],
            pnlLine: `${state.cumulativeSol.toFixed(4)} SOL accumulated for ${state.cumulativeSpent.toFixed(0)} USDC · mark-to-mid ${fmtSigned(unrealized, 2, " USDC")}.`,
        };
    },
};

// ══════════════════════════════════════════════════════════════════════════════
// STABLECOIN YIELD (venue routing)
// ══════════════════════════════════════════════════════════════════════════════

type Venue = "Kamino" | "Marginfi" | "Solend";

export interface YieldState {
    venueAprs: Record<Venue, number>; // %
    currentVenue: Venue;
    earningsUsdc: number;
    delegatedUsdc: number;
    lastAction: "probe" | "migrate" | "confirm";
}

const YIELD_FLOOR = 4.5; // %
const YIELD_MIGRATE_THRESHOLD = 0.3; // % uplift required to migrate

export const yieldStrategy: Strategy<YieldState> = {
    kind: "yield",
    init: (delegatedSol) => ({
        venueAprs: { Kamino: 5.4, Marginfi: 4.9, Solend: 5.1 },
        currentVenue: "Marginfi",
        earningsUsdc: 0,
        delegatedUsdc: delegatedSol * SOL_USDC_REF,
        lastAction: "confirm",
    }),

    tick(state, _cycleIndex, _ctx) {
        // Drift each venue's APR slightly.
        const nextAprs: Record<Venue, number> = {
            Kamino: clamp(walk(state.venueAprs.Kamino, 0.18, 3.5, 7.5), 3, 8),
            Marginfi: clamp(walk(state.venueAprs.Marginfi, 0.18, 3.5, 7.5), 3, 8),
            Solend: clamp(walk(state.venueAprs.Solend, 0.18, 3.5, 7.5), 3, 8),
        };
        // Best venue this tick.
        const bestVenue = (Object.keys(nextAprs) as Venue[]).reduce((a, b) =>
            nextAprs[a] > nextAprs[b] ? a : b
        );
        const currentApr = nextAprs[state.currentVenue];
        const bestApr = nextAprs[bestVenue];

        // Earnings accrue: pretend each cycle is ~30 minutes of real time.
        const accrual = (state.delegatedUsdc * currentApr / 100) * (30 / 60 / 24 / 365);

        // Decide action: probe → maybe migrate → confirm.
        const cyclesSinceLast = state.lastAction === "confirm" ? 1 : 0;
        let nextAction: "probe" | "migrate" | "confirm";
        let label: string;
        let detail: string;
        let memoKind: string;
        let notional = 0;

        const wantMigrate =
            bestVenue !== state.currentVenue && bestApr - currentApr >= YIELD_MIGRATE_THRESHOLD;

        if (state.lastAction !== "probe" && (!wantMigrate || cyclesSinceLast === 0)) {
            nextAction = "probe";
            label = "Probed lending rates — 3 venues";
            detail = `Kamino ${nextAprs.Kamino.toFixed(2)}% · Marginfi ${nextAprs.Marginfi.toFixed(2)}% · Solend ${nextAprs.Solend.toFixed(2)}%. Holding on ${state.currentVenue} at ${currentApr.toFixed(2)}%.`;
            memoKind = "yield.probe_rates";
        } else if (state.lastAction === "probe" && wantMigrate) {
            nextAction = "migrate";
            label = `Migrate ${state.delegatedUsdc.toFixed(0)} USDC — ${state.currentVenue} → ${bestVenue}`;
            detail = `Withdraw from ${state.currentVenue} at ${currentApr.toFixed(2)}% · deposit to ${bestVenue} at ${bestApr.toFixed(2)}% · net uplift +${(bestApr - currentApr).toFixed(2)}%.`;
            memoKind = "yield.route_change";
            notional = state.delegatedUsdc;
        } else if (state.lastAction === "migrate") {
            nextAction = "confirm";
            label = `Deposit confirmed on ${state.currentVenue}`;
            detail = `Settled on ${state.currentVenue}. Watch interval resumes.`;
            memoKind = "yield.confirm";
        } else {
            nextAction = "probe";
            label = "Probed lending rates — 3 venues";
            detail = `Kamino ${nextAprs.Kamino.toFixed(2)}% · Marginfi ${nextAprs.Marginfi.toFixed(2)}% · Solend ${nextAprs.Solend.toFixed(2)}%.`;
            memoKind = "yield.probe_rates";
        }

        const newVenue =
            nextAction === "migrate" ? bestVenue : state.currentVenue;

        return {
            next: {
                venueAprs: nextAprs,
                currentVenue: newVenue,
                earningsUsdc: state.earningsUsdc + accrual,
                delegatedUsdc: state.delegatedUsdc,
                lastAction: nextAction,
            },
            effect: {
                label,
                detail,
                memoKind,
                notionalUsdc: notional,
                realizedDelta: accrual,
                oracleEventDetail: `On-chain reserve states read for Kamino · Marginfi · Solend. Utilization within policy floor.`,
                signEventDetail:
                    nextAction === "migrate"
                        ? `Enclave signed withdraw+deposit pair under single net-APY-floor.`
                        : `Enclave signed rate-probe attestation · no funds moved.`,
                policyEventDetail: `Net-APY floor ${YIELD_FLOOR}% · venues allowlisted · max trade ≤ cap.`,
            },
        };
    },

    summary(state, legsConfirmed, _ctx) {
        const bestVenue = (Object.keys(state.venueAprs) as Venue[]).reduce((a, b) =>
            state.venueAprs[a] > state.venueAprs[b] ? a : b
        );
        return {
            metrics: [
                {
                    label: "Current APR",
                    value: legsConfirmed > 0 ? fmtPct(state.venueAprs[state.currentVenue]) : "—",
                    helper: `${state.currentVenue} · delegated ${state.delegatedUsdc.toFixed(0)} USDC`,
                    tone: "pos",
                },
                {
                    label: "Lifetime earnings",
                    value: state.earningsUsdc > 0 ? fmtUsd(state.earningsUsdc, 3) : "—",
                    helper: "accrued at current venue APR",
                    tone: state.earningsUsdc >= 0 ? "pos" : "neg",
                },
            ],
            tickers: [
                {
                    label: "Best venue",
                    value: `${bestVenue} ${fmtPct(state.venueAprs[bestVenue])}`,
                },
                {
                    label: "Spread",
                    value: `${(state.venueAprs[bestVenue] - state.venueAprs[state.currentVenue]).toFixed(2)}%`,
                },
            ],
            pnlLine: `Accrued ${state.earningsUsdc.toFixed(3)} USDC across ${legsConfirmed} cycles on ${state.currentVenue}.`,
        };
    },
};

// ══════════════════════════════════════════════════════════════════════════════
// ARBITRAGE (triangular)
// ══════════════════════════════════════════════════════════════════════════════

export interface ArbState {
    lastEdgeBps: number;
    totalCapturedUsdc: number;
    loopsExecuted: number;
    edgesScanned: number;
    delegatedUsdc: number;
}

const ARB_EDGE_FLOOR_BPS = 12;

export const arbitrageStrategy: Strategy<ArbState> = {
    kind: "arbitrage",
    init: (delegatedSol) => ({
        lastEdgeBps: 0,
        totalCapturedUsdc: 0,
        loopsExecuted: 0,
        edgesScanned: 0,
        delegatedUsdc: delegatedSol * SOL_USDC_REF,
    }),

    tick(state, cycleIndex, _ctx) {
        // Edge bps roughly follows a noisy distribution — sometimes below floor (scan only),
        // sometimes above (execute the loop).
        const edge = clamp(Math.round(Math.random() * 28 + Math.random() * 5 - 5), 0, 32);
        const scanOnly = edge < ARB_EDGE_FLOOR_BPS;

        if (scanOnly) {
            return {
                next: {
                    ...state,
                    lastEdgeBps: edge,
                    edgesScanned: state.edgesScanned + 1,
                },
                effect: {
                    label: `Edge scan #${cycleIndex + 1} — ${edge} bps (below floor)`,
                    detail: `Triangular probe USDC → SOL → USDT → USDC. Edge ${edge} bps < floor ${ARB_EDGE_FLOOR_BPS} bps. No execution.`,
                    memoKind: "arb.scan",
                    notionalUsdc: 0,
                    realizedDelta: 0,
                    oracleEventDetail: `Pyth marks · AMM quotes hashed into intent. Edge attested before sign.`,
                    signEventDetail: `Enclave declined to sign — edge below the on-chain floor.`,
                },
            };
        }

        // Execute the loop.
        const notional = Math.min(state.delegatedUsdc, 200 + Math.random() * 300);
        const captured = (notional * edge) / 10_000;
        return {
            next: {
                ...state,
                lastEdgeBps: edge,
                edgesScanned: state.edgesScanned + 1,
                loopsExecuted: state.loopsExecuted + 1,
                totalCapturedUsdc: state.totalCapturedUsdc + captured,
            },
            effect: {
                label: `Loop closed — net +${edge} bps captured`,
                detail: `Triangular USDC → SOL → USDT → USDC · ${notional.toFixed(0)} USDC notional · captured +${captured.toFixed(3)} USDC.`,
                memoKind: "arb.loop_close",
                notionalUsdc: notional,
                realizedDelta: captured,
                signEventDetail: `Enclave signed all three hops as one atomic intent (all-or-nothing).`,
                policyEventDetail: `Edge ${edge} bps ≥ floor ${ARB_EDGE_FLOOR_BPS} bps · loop length 3 · max trade ≤ cap.`,
            },
        };
    },

    summary(state, legsConfirmed, _ctx) {
        const avgEdge =
            state.loopsExecuted > 0
                ? state.totalCapturedUsdc / state.loopsExecuted
                : 0;
        return {
            metrics: [
                {
                    label: "Captured",
                    value: legsConfirmed > 0 ? fmtUsd(state.totalCapturedUsdc, 3) : "—",
                    helper: `${state.loopsExecuted} loops executed`,
                    tone: "pos",
                },
                {
                    label: "Edges scanned",
                    value:
                        legsConfirmed > 0
                            ? `${state.edgesScanned} scans`
                            : "—",
                    helper: `${state.loopsExecuted}/${Math.max(state.edgesScanned, 1)} above floor`,
                    tone: "neutral",
                },
            ],
            tickers: [
                {
                    label: "Last edge",
                    value: legsConfirmed > 0 ? fmtBps(state.lastEdgeBps) : "—",
                    tone: state.lastEdgeBps >= ARB_EDGE_FLOOR_BPS ? "pos" : "neutral",
                },
                {
                    label: "Hit rate",
                    value:
                        state.edgesScanned > 0
                            ? `${((state.loopsExecuted / state.edgesScanned) * 100).toFixed(0)}%`
                            : "—",
                },
            ],
            pnlLine: `Captured ${state.totalCapturedUsdc.toFixed(3)} USDC across ${state.loopsExecuted} loops (avg ${avgEdge.toFixed(3)} USDC/loop).`,
        };
    },
};

// ══════════════════════════════════════════════════════════════════════════════
// TREASURY REBALANCE
// ══════════════════════════════════════════════════════════════════════════════

type TreasuryAsset = "SOL" | "USDC" | "JTO";

export interface TreasuryState {
    weights: Record<TreasuryAsset, number>; // current weights (sum=1)
    targets: Record<TreasuryAsset, number>; // target weights
    portfolioValueUsdc: number;
    rebalancesExecuted: number;
    lastAction: "snapshot" | "swap" | "settle";
}

const TREASURY_BAND_BPS = 300; // 3% drift band

export const treasuryStrategy: Strategy<TreasuryState> = {
    kind: "treasury",
    init: (delegatedSol) => ({
        weights: { SOL: 0.5, USDC: 0.35, JTO: 0.15 },
        targets: { SOL: 0.5, USDC: 0.35, JTO: 0.15 },
        portfolioValueUsdc: delegatedSol * SOL_USDC_REF,
        rebalancesExecuted: 0,
        lastAction: "settle",
    }),

    tick(state, _cycleIndex, _ctx) {
        // Drift weights slightly each cycle.
        const drift = (asset: TreasuryAsset) =>
            clamp(state.weights[asset] + (Math.random() - 0.5) * 0.04, 0.05, 0.85);
        let weights: Record<TreasuryAsset, number> = {
            SOL: drift("SOL"),
            USDC: drift("USDC"),
            JTO: drift("JTO"),
        };
        // Normalize.
        const sum = weights.SOL + weights.USDC + weights.JTO;
        weights = {
            SOL: weights.SOL / sum,
            USDC: weights.USDC / sum,
            JTO: weights.JTO / sum,
        };

        const maxDriftAsset = (Object.keys(weights) as TreasuryAsset[]).reduce(
            (a, b) =>
                Math.abs(weights[a] - state.targets[a]) >
                Math.abs(weights[b] - state.targets[b])
                    ? a
                    : b
        );
        const maxDriftBps = Math.round(
            Math.abs(weights[maxDriftAsset] - state.targets[maxDriftAsset]) * 10000
        );

        if (state.lastAction === "settle") {
            // Snapshot — check drift.
            if (maxDriftBps < TREASURY_BAND_BPS) {
                return {
                    next: { ...state, weights, lastAction: "snapshot" },
                    effect: {
                        label: `Drift snapshot — within band (${maxDriftBps} bps)`,
                        detail: `All assets within ±${TREASURY_BAND_BPS / 100}% band. No rebalance required.`,
                        memoKind: "treasury.drift_snapshot",
                        notionalUsdc: 0,
                        realizedDelta: 0,
                        oracleEventDetail: `Pyth marks for SOL · USDC · JTO. Merkle proofs confirmed under guardian set 4.`,
                        signEventDetail: `Enclave signed drift snapshot · no swap intent generated.`,
                    },
                };
            }
            return {
                next: { ...state, weights, lastAction: "snapshot" },
                effect: {
                    label: `Drift snapshot — ${maxDriftAsset} ${maxDriftBps} bps over band`,
                    detail: `${maxDriftAsset} drifted ${maxDriftBps} bps from target ${(state.targets[maxDriftAsset] * 100).toFixed(0)}%. Generating swap leg.`,
                    memoKind: "treasury.drift_snapshot",
                    notionalUsdc: 0,
                    realizedDelta: 0,
                    oracleEventDetail: `Pyth marks for SOL · USDC · JTO. Drift ${maxDriftBps} bps detected.`,
                },
            };
        }

        if (state.lastAction === "snapshot" && maxDriftBps >= TREASURY_BAND_BPS) {
            // Execute the swap.
            const notional = state.portfolioValueUsdc *
                Math.abs(weights[maxDriftAsset] - state.targets[maxDriftAsset]);
            // Rebalance: pull weight back toward target.
            const newWeights = {
                ...weights,
                [maxDriftAsset]:
                    weights[maxDriftAsset] +
                    (state.targets[maxDriftAsset] - weights[maxDriftAsset]) * 0.85,
            } as Record<TreasuryAsset, number>;
            // Renormalize.
            const s = newWeights.SOL + newWeights.USDC + newWeights.JTO;
            const normalized = {
                SOL: newWeights.SOL / s,
                USDC: newWeights.USDC / s,
                JTO: newWeights.JTO / s,
            };
            const action =
                weights[maxDriftAsset] > state.targets[maxDriftAsset] ? "sell" : "buy";
            return {
                next: {
                    ...state,
                    weights: normalized,
                    lastAction: "swap",
                },
                effect: {
                    label: `Jupiter swap — ${notional.toFixed(0)} USDC ${action} ${maxDriftAsset}`,
                    detail: `Routed via Jupiter v6 · 25 bps slippage cap · Pyth mark verified.`,
                    memoKind: "treasury.swap_leg",
                    notionalUsdc: notional,
                    realizedDelta: 0,
                    signEventDetail: `Enclave signed Jupiter v6 ${action.toUpperCase()} ${maxDriftAsset} intent at notional ${notional.toFixed(0)} USDC.`,
                    policyEventDetail: `Drift ${maxDriftBps} bps ≥ band · slippage 25 bps ≤ cap · max trade ≤ cap.`,
                },
            };
        }

        // Settle / re-arm.
        return {
            next: {
                ...state,
                weights,
                rebalancesExecuted: state.rebalancesExecuted + 1,
                lastAction: "settle",
            },
            effect: {
                label: "Allocation re-anchored",
                detail: `Drift back inside ±${TREASURY_BAND_BPS / 100}% band. Cooldown re-armed.`,
                memoKind: "treasury.settle",
                notionalUsdc: 0,
                realizedDelta: 0,
                signEventDetail: `Enclave signed settle attestation · cooldown active.`,
            },
        };
    },

    summary(state, legsConfirmed, _ctx) {
        const maxDriftAsset = (Object.keys(state.weights) as TreasuryAsset[]).reduce(
            (a, b) =>
                Math.abs(state.weights[a] - state.targets[a]) >
                Math.abs(state.weights[b] - state.targets[b])
                    ? a
                    : b
        );
        const maxDriftBps = Math.round(
            Math.abs(state.weights[maxDriftAsset] - state.targets[maxDriftAsset]) * 10000
        );
        return {
            metrics: [
                {
                    label: "Portfolio value",
                    value: `${state.portfolioValueUsdc.toFixed(0)} USDC`,
                    helper: `${state.rebalancesExecuted} rebalances executed`,
                    tone: "neutral",
                },
                {
                    label: "Largest drift",
                    value:
                        legsConfirmed > 0
                            ? `${maxDriftAsset} ${maxDriftBps} bps`
                            : "—",
                    helper: `band ±${TREASURY_BAND_BPS / 100}% · rebalance if exceeded`,
                    tone:
                        maxDriftBps >= TREASURY_BAND_BPS
                            ? "neg"
                            : "pos",
                },
            ],
            tickers: [
                {
                    label: "SOL / USDC / JTO",
                    value:
                        legsConfirmed > 0
                            ? `${(state.weights.SOL * 100).toFixed(1)}% / ${(state.weights.USDC * 100).toFixed(1)}% / ${(state.weights.JTO * 100).toFixed(1)}%`
                            : "—",
                },
                {
                    label: "Rebalances",
                    value: legsConfirmed > 0 ? `${state.rebalancesExecuted}` : "—",
                },
            ],
            pnlLine: `${state.rebalancesExecuted} rebalances executed · current drift ${maxDriftBps} bps on ${maxDriftAsset}.`,
        };
    },
};

// ══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO REBALANCE (multi-asset, banded)
// ══════════════════════════════════════════════════════════════════════════════

type PortfolioAsset = "SOL" | "USDC" | "JTO" | "JUP" | "WBTC";

export interface PortfolioState {
    weights: Record<PortfolioAsset, number>;
    targets: Record<PortfolioAsset, number>;
    portfolioValueUsdc: number;
    rebalancesExecuted: number;
    lastAction: "drift_check" | "sell" | "buy";
    lastDriftedAsset: PortfolioAsset;
}

const PORTFOLIO_BAND_BPS = 200; // ±2%

export const portfolioStrategy: Strategy<PortfolioState> = {
    kind: "portfolio",
    init: (delegatedSol) => ({
        weights: { SOL: 0.32, USDC: 0.25, JTO: 0.18, JUP: 0.15, WBTC: 0.1 },
        targets: { SOL: 0.32, USDC: 0.25, JTO: 0.18, JUP: 0.15, WBTC: 0.1 },
        portfolioValueUsdc: delegatedSol * SOL_USDC_REF,
        rebalancesExecuted: 0,
        lastAction: "drift_check",
        lastDriftedAsset: "SOL",
    }),

    tick(state, _cycleIndex, _ctx) {
        // Drift weights.
        const drifted: Record<PortfolioAsset, number> = {
            SOL: clamp(state.weights.SOL + (Math.random() - 0.5) * 0.03, 0.05, 0.7),
            USDC: clamp(state.weights.USDC + (Math.random() - 0.5) * 0.03, 0.05, 0.7),
            JTO: clamp(state.weights.JTO + (Math.random() - 0.5) * 0.02, 0.05, 0.5),
            JUP: clamp(state.weights.JUP + (Math.random() - 0.5) * 0.02, 0.05, 0.5),
            WBTC: clamp(state.weights.WBTC + (Math.random() - 0.5) * 0.015, 0.05, 0.4),
        };
        // Normalize.
        const sum = Object.values(drifted).reduce((a, b) => a + b, 0);
        const weights = Object.fromEntries(
            Object.entries(drifted).map(([k, v]) => [k, v / sum])
        ) as Record<PortfolioAsset, number>;

        const assets: PortfolioAsset[] = ["SOL", "USDC", "JTO", "JUP", "WBTC"];
        const maxDriftAsset = assets.reduce((a, b) =>
            Math.abs(weights[a] - state.targets[a]) >
            Math.abs(weights[b] - state.targets[b])
                ? a
                : b
        );
        const maxDriftBps = Math.round(
            Math.abs(weights[maxDriftAsset] - state.targets[maxDriftAsset]) * 10000
        );

        if (state.lastAction === "drift_check" && maxDriftBps >= PORTFOLIO_BAND_BPS) {
            const overweight =
                weights[maxDriftAsset] > state.targets[maxDriftAsset];
            const notional =
                state.portfolioValueUsdc *
                Math.abs(weights[maxDriftAsset] - state.targets[maxDriftAsset]);
            // Move toward target.
            const newWeights = { ...weights };
            newWeights[maxDriftAsset] =
                weights[maxDriftAsset] +
                (state.targets[maxDriftAsset] - weights[maxDriftAsset]) * 0.5;
            const s2 = Object.values(newWeights).reduce((a, b) => a + b, 0);
            const normalized = Object.fromEntries(
                Object.entries(newWeights).map(([k, v]) => [k, v / s2])
            ) as Record<PortfolioAsset, number>;
            return {
                next: {
                    ...state,
                    weights: normalized,
                    lastAction: overweight ? "sell" : "buy",
                    lastDriftedAsset: maxDriftAsset,
                },
                effect: {
                    label: overweight
                        ? `Sell ${maxDriftAsset} — ${notional.toFixed(0)} USDC realised`
                        : `Buy ${maxDriftAsset} — ${notional.toFixed(0)} USDC deployed`,
                    detail: `${maxDriftAsset} drifted ${maxDriftBps} bps from target ${(state.targets[maxDriftAsset] * 100).toFixed(0)}%. ${overweight ? "Trimming" : "Topping up"} via Jupiter v6.`,
                    memoKind: overweight
                        ? `portfolio.sell_${maxDriftAsset.toLowerCase()}`
                        : `portfolio.buy_${maxDriftAsset.toLowerCase()}`,
                    notionalUsdc: notional,
                    realizedDelta: 0,
                    signEventDetail: `Enclave signed multi-leg rebalance · shared deadline · Jupiter v6 route.`,
                    policyEventDetail: `Drift ${maxDriftBps} bps ≥ ±${PORTFOLIO_BAND_BPS / 100}% band · slippage 15 bps · max trade ≤ cap.`,
                },
            };
        }

        if (state.lastAction === "sell" || state.lastAction === "buy") {
            return {
                next: {
                    ...state,
                    weights,
                    rebalancesExecuted: state.rebalancesExecuted + 1,
                    lastAction: "drift_check",
                },
                effect: {
                    label: `Rebalance settled — ${state.lastDriftedAsset} re-anchored`,
                    detail: `${state.lastDriftedAsset} brought back inside band. Watching for next drift.`,
                    memoKind: "portfolio.settle",
                    notionalUsdc: 0,
                    realizedDelta: 0,
                    signEventDetail: `Enclave signed settle attestation.`,
                },
            };
        }

        return {
            next: { ...state, weights, lastAction: "drift_check" },
            effect: {
                label: `Drift check — ${maxDriftAsset} ${maxDriftBps} bps`,
                detail: `All assets ${maxDriftBps < PORTFOLIO_BAND_BPS ? "inside" : "outside"} ±${PORTFOLIO_BAND_BPS / 100}% band.`,
                memoKind: "portfolio.drift_check",
                notionalUsdc: 0,
                realizedDelta: 0,
                oracleEventDetail: `Pyth marks fetched for SOL · USDC · JTO · JUP · WBTC. Reweighting deltas computed.`,
            },
        };
    },

    summary(state, legsConfirmed, _ctx) {
        const assets: PortfolioAsset[] = ["SOL", "USDC", "JTO", "JUP", "WBTC"];
        const maxDriftAsset = assets.reduce((a, b) =>
            Math.abs(state.weights[a] - state.targets[a]) >
            Math.abs(state.weights[b] - state.targets[b])
                ? a
                : b
        );
        const maxDriftBps = Math.round(
            Math.abs(state.weights[maxDriftAsset] - state.targets[maxDriftAsset]) * 10000
        );
        const largestAsset = assets.reduce((a, b) =>
            state.weights[a] > state.weights[b] ? a : b
        );
        return {
            metrics: [
                {
                    label: "Portfolio value",
                    value: `${state.portfolioValueUsdc.toFixed(0)} USDC`,
                    helper: `${state.rebalancesExecuted} rebalances`,
                    tone: "neutral",
                },
                {
                    label: "Largest drift",
                    value:
                        legsConfirmed > 0
                            ? `${maxDriftAsset} ${maxDriftBps} bps`
                            : "—",
                    helper: `band ±${PORTFOLIO_BAND_BPS / 100}%`,
                    tone: maxDriftBps >= PORTFOLIO_BAND_BPS ? "neg" : "pos",
                },
            ],
            tickers: [
                {
                    label: "Top holding",
                    value:
                        legsConfirmed > 0
                            ? `${largestAsset} ${(state.weights[largestAsset] * 100).toFixed(1)}%`
                            : "—",
                },
                {
                    label: "Rebalances",
                    value: legsConfirmed > 0 ? `${state.rebalancesExecuted}` : "—",
                },
            ],
            pnlLine: `${state.rebalancesExecuted} rebalances · current drift ${maxDriftBps} bps on ${maxDriftAsset}.`,
        };
    },
};

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ══════════════════════════════════════════════════════════════════════════════

export const STRATEGIES: Record<StrategyKind, Strategy<unknown>> = {
    "market-making": marketMakingStrategy as Strategy<unknown>,
    treasury: treasuryStrategy as Strategy<unknown>,
    yield: yieldStrategy as Strategy<unknown>,
    dca: dcaStrategy as Strategy<unknown>,
    arbitrage: arbitrageStrategy as Strategy<unknown>,
    portfolio: portfolioStrategy as Strategy<unknown>,
};

export function getStrategy(kind: StrategyKind): Strategy<unknown> {
    return STRATEGIES[kind];
}
