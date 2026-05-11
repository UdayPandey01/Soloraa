/**
 * Catalog of built-in agents. Each entry powers /agents (grid), /agent/[id]
 * (detail + config + live execution), and the SDK example presets.
 *
 * Constraints belong here as defaults — the UI surfaces them and lets users
 * tighten (never loosen relative to wallet.policy on-chain). Risk score is a
 * subjective banding (1–5) we use for the UI; the actual on-chain policy is
 * exact bps/USDC caps.
 *
 * The `series` arrays are 30 deterministic data points used for sparkline
 * previews in the listing grid. They are illustrative, not historical.
 */

export type AgentRisk = "conservative" | "moderate" | "aggressive";
export type AgentStatus = "live" | "beta" | "preview";

export interface AgentProtocol {
    name: string;
    programId: string;
    role: string;
}

export interface AgentConfigSchema {
    capitalUsdcMin: number;
    capitalUsdcMax: number;
    maxTradeUsdcDefault: number;
    maxSlippageBpsDefault: number;
    stopLossBpsDefault: number;
    cooldownSecDefault: number;
    executionsPerHourDefault: number;
    allowedTokens: string[];
}

export interface AgentExecutionLeg {
    /** Short label shown in the live execution feed. */
    label: string;
    /** Human-readable detail. */
    detail: string;
    /** Memo-program payload prefix for the real devnet tx. */
    memoKind: string;
    /** USDC drawdown shown against the delegated balance for this leg. */
    notionalUsdc: number;
}

export interface Agent {
    id: string;
    name: string;
    tagline: string;
    description: string;
    thesis: string;
    risk: AgentRisk;
    status: AgentStatus;
    /** Subjective risk on a 1–5 scale. Only for the UI bar. */
    riskScore: 1 | 2 | 3 | 4 | 5;
    /** Backtested-style annualized return, in bps. UI illustration only. */
    simulatedApyBps: number;
    /** Median seconds between execution attempts. */
    cadenceSecMedian: number;
    /** Average drawdown observed in simulation, in bps. */
    simulatedDrawdownBps: number;
    protocols: AgentProtocol[];
    config: AgentConfigSchema;
    /** Deterministic illustrative PnL series — relative cumulative basis points. */
    series: number[];
    /** Sequence of legs played as real devnet memo txs after mock pipeline. */
    executionLegs: AgentExecutionLeg[];
}

export const AGENTS: Agent[] = [
    {
        id: "market-making-sol-usdc",
        name: "Market making",
        tagline: "Maintain bid/ask depth on SOL/USDC under tight inventory caps.",
        description:
            "Posts symmetric bid/ask quotes around the verified Pyth mid, withdraws under volatility surges, and re-quotes on every confirmed fill. Inventory is bounded; the enclave refuses any intent that would push position past the configured cap.",
        thesis:
            "Spreads on SOL/USDC compress and decompress on a predictable diurnal cycle. A bounded inventory strategy with attested oracle freshness captures spread without taking directional risk.",
        risk: "moderate",
        riskScore: 3,
        status: "live",
        simulatedApyBps: 1420,
        cadenceSecMedian: 8,
        simulatedDrawdownBps: 180,
        protocols: [
            { name: "Phoenix v1", programId: "PhoeNi…", role: "Order book" },
            { name: "Pyth Hermes", programId: "—", role: "Price oracle" },
        ],
        config: {
            capitalUsdcMin: 1000,
            capitalUsdcMax: 250_000,
            maxTradeUsdcDefault: 5000,
            maxSlippageBpsDefault: 8,
            stopLossBpsDefault: 200,
            cooldownSecDefault: 2,
            executionsPerHourDefault: 240,
            allowedTokens: ["SOL", "USDC"],
        },
        series: [
            0, 12, 27, 41, 48, 38, 55, 71, 84, 92, 88, 103, 121, 138, 142, 156, 172,
            181, 190, 207, 215, 198, 224, 240, 251, 263, 280, 292, 303, 312,
        ],
        executionLegs: [
            {
                label: "Quote refresh — bid 142.18",
                detail: "Symmetric maker quote on SOL/USDC, 5 bps inside Pyth mid.",
                memoKind: "mm.quote_refresh",
                notionalUsdc: 320,
            },
            {
                label: "Fill confirmed — 12.4 SOL",
                detail: "Maker fill against incoming taker. Inventory delta within cap.",
                memoKind: "mm.fill",
                notionalUsdc: 760,
            },
            {
                label: "Inventory rebalance",
                detail: "Trim long inventory back to neutral target band.",
                memoKind: "mm.rebalance",
                notionalUsdc: 180,
            },
        ],
    },
    {
        id: "treasury-rebalance",
        name: "Treasury rebalancing",
        tagline: "Hold a target allocation across SOL, USDC, JTO; rebalance on drift.",
        description:
            "Reads on-chain treasury balances, computes drift against target weights, and proposes trades only when drift exceeds the configured threshold. Each rebalance is a single bounded intent.",
        thesis:
            "Treasuries that rebalance on a fixed cadence systematically underperform threshold rebalancing for the same risk budget. Attesting the threshold and the price source removes governance ambiguity.",
        risk: "conservative",
        riskScore: 1,
        status: "live",
        simulatedApyBps: 480,
        cadenceSecMedian: 21_600,
        simulatedDrawdownBps: 90,
        protocols: [
            { name: "Jupiter v6", programId: "JUP6Lk…", role: "Swap router" },
            { name: "Pyth Hermes", programId: "—", role: "Mark prices" },
        ],
        config: {
            capitalUsdcMin: 10_000,
            capitalUsdcMax: 5_000_000,
            maxTradeUsdcDefault: 50_000,
            maxSlippageBpsDefault: 25,
            stopLossBpsDefault: 0,
            cooldownSecDefault: 3600,
            executionsPerHourDefault: 1,
            allowedTokens: ["SOL", "USDC", "JTO", "JUP"],
        },
        series: [
            0, 4, 9, 13, 17, 23, 28, 32, 38, 42, 47, 53, 58, 62, 67, 71, 76, 80, 84,
            89, 94, 98, 103, 107, 112, 116, 121, 125, 130, 134,
        ],
        executionLegs: [
            {
                label: "Drift snapshot — SOL +3.4%",
                detail: "SOL overweight vs target band. Generating sell leg into USDC.",
                memoKind: "treasury.drift_snapshot",
                notionalUsdc: 1200,
            },
            {
                label: "Swap leg confirmed (Jupiter v6)",
                detail: "Routed via Jupiter v6 with 25 bps slippage cap. Verified Pyth mark.",
                memoKind: "treasury.swap_leg",
                notionalUsdc: 8400,
            },
            {
                label: "Position settled — back to target",
                detail: "Post-trade allocation re-anchored to policy weights.",
                memoKind: "treasury.settle",
                notionalUsdc: 0,
            },
        ],
    },
    {
        id: "stablecoin-yield",
        name: "Stablecoin yield",
        tagline: "Route USDC across attested lending markets, never below floor.",
        description:
            "Polls supply rates across allowlisted lending venues, moves principal to the highest after fees, and refuses any move that would drop net APY below the configured floor or break borrow caps.",
        thesis:
            "Stablecoin yield migrates between venues weekly. A bounded auto-router that won't accept negative-net-APY moves captures most of the spread without ever holding risk-on duration.",
        risk: "conservative",
        riskScore: 2,
        status: "live",
        simulatedApyBps: 740,
        cadenceSecMedian: 1800,
        simulatedDrawdownBps: 30,
        protocols: [
            { name: "Kamino", programId: "Kami…", role: "Lending" },
            { name: "Marginfi v2", programId: "Mfi2…", role: "Lending" },
            { name: "Solend", programId: "Solen…", role: "Lending" },
        ],
        config: {
            capitalUsdcMin: 5000,
            capitalUsdcMax: 10_000_000,
            maxTradeUsdcDefault: 100_000,
            maxSlippageBpsDefault: 5,
            stopLossBpsDefault: 0,
            cooldownSecDefault: 900,
            executionsPerHourDefault: 2,
            allowedTokens: ["USDC", "USDT"],
        },
        series: [
            0, 6, 12, 18, 23, 28, 33, 39, 44, 50, 55, 60, 66, 71, 76, 82, 87, 92, 97,
            103, 108, 113, 118, 124, 129, 134, 139, 145, 150, 155,
        ],
        executionLegs: [
            {
                label: "Probe supply rates — 3 venues",
                detail: "Kamino 5.4% · Marginfi 4.9% · Solend 5.1% net APY.",
                memoKind: "yield.probe_rates",
                notionalUsdc: 0,
            },
            {
                label: "Route migration — Marginfi → Kamino",
                detail: "Withdraw + deposit pair. Net APY uplift +0.5% after fees.",
                memoKind: "yield.route_change",
                notionalUsdc: 5000,
            },
            {
                label: "Position confirmed on Kamino",
                detail: "Deposit settled. Watch interval resumes at 30m cadence.",
                memoKind: "yield.confirm",
                notionalUsdc: 0,
            },
        ],
    },
    {
        id: "dca-allocator",
        name: "DCA allocator",
        tagline: "Recurring buys with attested price reads and signed intent batching.",
        description:
            "Executes a configurable purchase schedule across a basket of target assets. Each leg is a separate signed intent — no batching window can mask a single leg failing.",
        thesis:
            "DCA is a discipline strategy. Removing the human from the loop while making every execution auditable on-chain makes the discipline visible.",
        risk: "conservative",
        riskScore: 1,
        status: "live",
        simulatedApyBps: 0,
        cadenceSecMedian: 86_400,
        simulatedDrawdownBps: 0,
        protocols: [
            { name: "Jupiter v6", programId: "JUP6Lk…", role: "Swap router" },
        ],
        config: {
            capitalUsdcMin: 100,
            capitalUsdcMax: 1_000_000,
            maxTradeUsdcDefault: 500,
            maxSlippageBpsDefault: 50,
            stopLossBpsDefault: 0,
            cooldownSecDefault: 86_400,
            executionsPerHourDefault: 1,
            allowedTokens: ["USDC", "SOL", "JTO", "JUP", "WBTC"],
        },
        series: [
            0, 3, 6, 9, 12, 15, 18, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55,
            58, 61, 64, 67, 70, 73, 76, 79, 82, 85, 88,
        ],
        executionLegs: [
            {
                label: "Buy leg #1 — 250 USDC → SOL",
                detail: "DCA tranche 1/3. Pyth mark + 30 bps slippage cap.",
                memoKind: "dca.leg_1",
                notionalUsdc: 250,
            },
            {
                label: "Buy leg #2 — 250 USDC → SOL",
                detail: "DCA tranche 2/3. Auto-batched with 6s spacing.",
                memoKind: "dca.leg_2",
                notionalUsdc: 250,
            },
            {
                label: "Buy leg #3 — 500 USDC → WBTC",
                detail: "Cross-basket allocator. WBTC sleeve top-up.",
                memoKind: "dca.leg_3",
                notionalUsdc: 500,
            },
        ],
    },
    {
        id: "arbitrage-monitor",
        name: "Arbitrage monitor",
        tagline: "Triangular monitor across Jupiter routes — execute on attested edge.",
        description:
            "Continuously evaluates triangular price loops across allowlisted swap routes. Only executes when the expected net edge after fees clears the configured floor.",
        thesis:
            "Edges on Solana's swap graph open and close in seconds. A bounded executor that takes only attested edges above a floor is structurally net-positive and never carries inventory overnight.",
        risk: "aggressive",
        riskScore: 4,
        status: "beta",
        simulatedApyBps: 2480,
        cadenceSecMedian: 12,
        simulatedDrawdownBps: 320,
        protocols: [
            { name: "Jupiter v6", programId: "JUP6Lk…", role: "Swap router" },
            { name: "Pyth Hermes", programId: "—", role: "Mark prices" },
        ],
        config: {
            capitalUsdcMin: 5000,
            capitalUsdcMax: 500_000,
            maxTradeUsdcDefault: 25_000,
            maxSlippageBpsDefault: 12,
            stopLossBpsDefault: 100,
            cooldownSecDefault: 5,
            executionsPerHourDefault: 60,
            allowedTokens: ["USDC", "SOL", "USDT", "JTO", "JUP"],
        },
        series: [
            0, 18, 9, 32, 24, 51, 41, 67, 80, 72, 95, 110, 96, 124, 138, 152, 144,
            171, 188, 202, 195, 217, 235, 228, 251, 270, 264, 287, 305, 320,
        ],
        executionLegs: [
            {
                label: "Edge detected — USDC→SOL→USDT",
                detail: "Triangular edge 17 bps net of fees. Above the policy floor.",
                memoKind: "arb.edge_detected",
                notionalUsdc: 0,
            },
            {
                label: "Hop 1 confirmed — USDC → SOL",
                detail: "First leg of the loop confirmed. Inventory marked.",
                memoKind: "arb.hop_1",
                notionalUsdc: 4200,
            },
            {
                label: "Loop closed — net +14 bps",
                detail: "Final hop settled. Inventory back to USDC. Edge captured.",
                memoKind: "arb.loop_close",
                notionalUsdc: 4200,
            },
        ],
    },
    {
        id: "portfolio-rebalance",
        name: "Portfolio rebalance",
        tagline: "Multi-asset target weights with band-based rebalancing.",
        description:
            "Holds a user-defined weighting across SOL, USDC, JTO, JUP, WBTC. Rebalances when any asset drifts outside its band. Each rebalance is a sequence of bounded intents with shared deadline.",
        thesis:
            "Diversified Solana portfolios drift quickly. Banded rebalancing under cryptographic policy removes operator discretion without losing the option to widen bands during volatility.",
        risk: "moderate",
        riskScore: 3,
        status: "preview",
        simulatedApyBps: 920,
        cadenceSecMedian: 7200,
        simulatedDrawdownBps: 240,
        protocols: [
            { name: "Jupiter v6", programId: "JUP6Lk…", role: "Swap router" },
            { name: "Pyth Hermes", programId: "—", role: "Mark prices" },
        ],
        config: {
            capitalUsdcMin: 1000,
            capitalUsdcMax: 2_000_000,
            maxTradeUsdcDefault: 10_000,
            maxSlippageBpsDefault: 15,
            stopLossBpsDefault: 150,
            cooldownSecDefault: 600,
            executionsPerHourDefault: 6,
            allowedTokens: ["SOL", "USDC", "JTO", "JUP", "WBTC"],
        },
        series: [
            0, 8, 15, 21, 28, 22, 35, 44, 52, 47, 60, 71, 80, 75, 89, 100, 110, 105,
            120, 132, 142, 138, 154, 165, 175, 169, 186, 198, 209, 215,
        ],
        executionLegs: [
            {
                label: "Drift check — SOL +2.1% / JTO −1.4%",
                detail: "Two assets outside their bands. Rebalance approved.",
                memoKind: "portfolio.drift_check",
                notionalUsdc: 0,
            },
            {
                label: "Rebalance leg — sell SOL",
                detail: "Trim SOL overweight. Routed via Jupiter v6.",
                memoKind: "portfolio.sell_sol",
                notionalUsdc: 2200,
            },
            {
                label: "Rebalance leg — buy JTO",
                detail: "Bring JTO back to its target weight.",
                memoKind: "portfolio.buy_jto",
                notionalUsdc: 1400,
            },
        ],
    },
];

export function getAgent(id: string): Agent | undefined {
    return AGENTS.find((a) => a.id === id);
}

export function formatUsdc(amount: number): string {
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k`;
    return amount.toLocaleString();
}

export function formatBps(bps: number): string {
    return `${(bps / 100).toFixed(2)}%`;
}

export function formatCadence(seconds: number): string {
    if (seconds >= 86_400) return `${(seconds / 86_400).toFixed(0)}d`;
    if (seconds >= 3600) return `${(seconds / 3600).toFixed(0)}h`;
    if (seconds >= 60) return `${(seconds / 60).toFixed(0)}m`;
    return `${seconds}s`;
}
