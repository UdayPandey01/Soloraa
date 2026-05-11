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
    label: string;
    detail: string;
    memoKind: string;
    notionalFraction: number;
}

export interface AgentExecutionCopy {
    intentDetail: string;
    policyDetail: string;
    oracleTitle: string;
    oracleDetail: string;
    signDetail: string;
    broadcastDetail: string;
    verifyDetail: string;
}

export interface Agent {
    id: string;
    name: string;
    tagline: string;
    description: string;
    thesis: string;
    risk: AgentRisk;
    status: AgentStatus;
    riskScore: 1 | 2 | 3 | 4 | 5;
    simulatedApyBps: number;
    cadenceSecMedian: number;
    simulatedDrawdownBps: number;
    protocols: AgentProtocol[];
    config: AgentConfigSchema;
    series: number[];
    executionLegs: AgentExecutionLeg[];
    executionCopy: AgentExecutionCopy;
}

const SOL_USDC_REF = 142;

export function interpolate(
    template: string,
    vars: Record<string, string | number>
): string {
    return template.replace(/\{(\w+)\}/g, (_, key) =>
        key in vars ? String(vars[key]) : `{${key}}`
    );
}

export function legNotionalUsdc(leg: AgentExecutionLeg, delegatedUsdc: number): number {
    return Math.round(delegatedUsdc * leg.notionalFraction);
}

export function legNotionalSol(leg: AgentExecutionLeg, delegatedUsdc: number): number {
    return legNotionalUsdc(leg, delegatedUsdc) / SOL_USDC_REF;
}

export function legVariables(
    leg: AgentExecutionLeg,
    delegatedUsdc: number
): { usdc: string; sol: string; pct: string } {
    const usdc = legNotionalUsdc(leg, delegatedUsdc);
    const sol = legNotionalSol(leg, delegatedUsdc);
    return {
        usdc: usdc.toLocaleString(undefined, { maximumFractionDigits: 0 }),
        sol: sol.toFixed(sol < 10 ? 3 : 2),
        pct: `${(leg.notionalFraction * 100).toFixed(0)}%`,
    };
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
                label: "Quote refresh — {sol} SOL bid posted",
                detail: "Symmetric maker quote on SOL/USDC, 5 bps inside Pyth mid.",
                memoKind: "mm.quote_refresh",
                notionalFraction: 0.13,
            },
            {
                label: "Maker fill — {sol} SOL @ bid",
                detail: "Maker fill against incoming taker. Inventory delta within cap.",
                memoKind: "mm.fill",
                notionalFraction: 0.30,
            },
            {
                label: "Inventory trim — {usdc} USDC",
                detail: "Trim long inventory back to neutral target band.",
                memoKind: "mm.rebalance",
                notionalFraction: 0.07,
            },
        ],
        executionCopy: {
            intentDetail:
                "{agentName}: maker quote intent from {walletShort} · cap {delegated} USDC.",
            policyDetail:
                "delegated {delegated} USDC · max trade {maxTrade} USDC · inventory cap 50% · spread floor 8 bps.",
            oracleTitle: "Pyth SOL/USDC verified",
            oracleDetail:
                "Mid 142.18 · confidence 4 bps · Wormhole guardians 13/19 · merkle proof binds feed_id.",
            signDetail:
                "Sealed Ed25519 key signed Phoenix place_limit_order_with_free_funds intent.",
            broadcastDetail:
                "ComputeBudget · Ed25519Program (verify ix at index 0) · Phoenix place_limit_order_with_free_funds at index 1.",
            verifyDetail:
                "Ed25519 sysvar match · SlotHashes binding · nonce check · payload hash bound to (price, side, qty).",
        },
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
                label: "Drift snapshot — SOL +3.4% over band",
                detail: "SOL overweight vs target band. Generating sell leg into USDC.",
                memoKind: "treasury.drift_snapshot",
                notionalFraction: 0.10,
            },
            {
                label: "Jupiter swap — {usdc} USDC SOL → USDC",
                detail: "Routed via Jupiter v6 with 25 bps slippage cap. Verified Pyth mark.",
                memoKind: "treasury.swap_leg",
                notionalFraction: 0.70,
            },
            {
                label: "Allocation re-anchored",
                detail: "Drift back inside target band. Cooldown re-armed at 6h.",
                memoKind: "treasury.settle",
                notionalFraction: 0,
            },
        ],
        executionCopy: {
            intentDetail:
                "{agentName}: drift snapshot intent from {walletShort} · cap {delegated} USDC.",
            policyDetail:
                "delegated {delegated} USDC · max trade {maxTrade} USDC · drift band ±3% · slippage cap 25 bps.",
            oracleTitle: "Pyth marks verified",
            oracleDetail:
                "SOL · USDC · JTO mark prices fetched · merkle proofs confirmed under guardian set 4.",
            signDetail:
                "Sealed Ed25519 key signed Jupiter v6 swap intent for the largest-drift asset.",
            broadcastDetail:
                "ComputeBudget · Ed25519Program · Jupiter v6 shared_accounts_route at index 1.",
            verifyDetail:
                "Ed25519 sysvar match · SlotHashes binding · nonce check · payload hash bound to (route, slippage).",
        },
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
                label: "Probed lending rates — 3 venues",
                detail: "Kamino 5.4% · Marginfi 4.9% · Solend 5.1% net APY after fees.",
                memoKind: "yield.probe_rates",
                notionalFraction: 0,
            },
            {
                label: "Migrate {usdc} USDC — Marginfi → Kamino",
                detail: "Withdraw + deposit pair. Net APY uplift +0.5% after fees.",
                memoKind: "yield.route_change",
                notionalFraction: 0.85,
            },
            {
                label: "Deposit confirmed on Kamino",
                detail: "Deposit settled. Watch interval resumes at 30m cadence.",
                memoKind: "yield.confirm",
                notionalFraction: 0,
            },
        ],
        executionCopy: {
            intentDetail:
                "{agentName}: yield rebalance intent for {walletShort} · cap {delegated} USDC.",
            policyDetail:
                "delegated {delegated} USDC · max trade {maxTrade} USDC · net-APY floor 4.5% · venues allowlisted (Kamino · Marginfi · Solend).",
            oracleTitle: "Venue rates verified",
            oracleDetail:
                "On-chain reserve state read for each venue. Borrow caps + utilization within policy.",
            signDetail:
                "Enclave signed withdraw + deposit pair under a single net-APY-floor guarantee.",
            broadcastDetail:
                "ComputeBudget · Ed25519Program · Marginfi withdraw at index 1 · Kamino deposit at index 2.",
            verifyDetail:
                "Ed25519 sysvar match · SlotHashes · nonce · payload hash bound to (source venue, dest venue, amount).",
        },
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
                label: "Tranche 1/3 — {usdc} USDC → SOL",
                detail: "DCA tranche 1/3. Pyth mark + 50 bps slippage cap.",
                memoKind: "dca.leg_1",
                notionalFraction: 0.07,
            },
            {
                label: "Tranche 2/3 — {usdc} USDC → SOL",
                detail: "DCA tranche 2/3. Auto-batched with 6s spacing.",
                memoKind: "dca.leg_2",
                notionalFraction: 0.07,
            },
            {
                label: "Tranche 3/3 — {usdc} USDC → WBTC",
                detail: "Cross-basket allocator. WBTC sleeve top-up.",
                memoKind: "dca.leg_3",
                notionalFraction: 0.10,
            },
        ],
        executionCopy: {
            intentDetail:
                "{agentName}: scheduled tranche intent from {walletShort} · cap {delegated} USDC.",
            policyDetail:
                "delegated {delegated} USDC · max trade {maxTrade} USDC · cadence 24h · slippage cap 50 bps.",
            oracleTitle: "Pyth marks verified",
            oracleDetail:
                "SOL/USDC mid 142.31 · WBTC mid 64,820 · confidence intervals inside policy.",
            signDetail:
                "Enclave signed Jupiter v6 swap intent for the next-due tranche.",
            broadcastDetail:
                "ComputeBudget · Ed25519Program · Jupiter v6 shared_accounts_route at index 1.",
            verifyDetail:
                "Ed25519 sysvar match · SlotHashes · nonce · payload hash bound to (input mint, output mint, amount).",
        },
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
                label: "Edge detected — USDC → SOL → USDT loop",
                detail: "Triangular edge 17 bps net of fees. Above the policy floor.",
                memoKind: "arb.edge_detected",
                notionalFraction: 0,
            },
            {
                label: "Hop 1 — {usdc} USDC → SOL",
                detail: "First leg of the loop. Inventory marked for the second hop.",
                memoKind: "arb.hop_1",
                notionalFraction: 0.42,
            },
            {
                label: "Loop closed — net +14 bps captured",
                detail: "Final hop settled. Inventory back to USDC. Edge captured.",
                memoKind: "arb.loop_close",
                notionalFraction: 0.42,
            },
        ],
        executionCopy: {
            intentDetail:
                "{agentName}: triangular edge probe from {walletShort} · cap {delegated} USDC.",
            policyDetail:
                "delegated {delegated} USDC · max trade {maxTrade} USDC · edge floor 12 bps · loop length 3 hops · cooldown 5s.",
            oracleTitle: "Pyth + AMM quotes verified",
            oracleDetail:
                "Pyth marks + AMM quotes hashed into the intent. Edge after fees clears the signed floor.",
            signDetail:
                "Enclave signed the entire triangular loop as one atomic intent (all-or-nothing).",
            broadcastDetail:
                "ComputeBudget · Ed25519Program · Jupiter v6 route_with_token_ledger at index 1.",
            verifyDetail:
                "Ed25519 sysvar match · SlotHashes · nonce · payload hash bound to (hops[], min net edge).",
        },
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
                notionalFraction: 0,
            },
            {
                label: "Sell SOL — {usdc} USDC realised",
                detail: "Trim SOL overweight. Routed via Jupiter v6.",
                memoKind: "portfolio.sell_sol",
                notionalFraction: 0.44,
            },
            {
                label: "Buy JTO — {usdc} USDC deployed",
                detail: "Bring JTO back to its target weight.",
                memoKind: "portfolio.buy_jto",
                notionalFraction: 0.28,
            },
        ],
        executionCopy: {
            intentDetail:
                "{agentName}: portfolio drift intent from {walletShort} · cap {delegated} USDC.",
            policyDetail:
                "delegated {delegated} USDC · max trade {maxTrade} USDC · drift band ±2% · slippage cap 15 bps.",
            oracleTitle: "Pyth marks verified",
            oracleDetail:
                "SOL · USDC · JTO · JUP · WBTC marks fetched. Reweighting deltas computed.",
            signDetail:
                "Enclave signed multi-leg rebalance under a single shared deadline.",
            broadcastDetail:
                "ComputeBudget · Ed25519Program · Jupiter v6 shared_accounts_route per asset.",
            verifyDetail:
                "Ed25519 sysvar match · SlotHashes · nonce · payload hash bound to (target weights, deadline).",
        },
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
