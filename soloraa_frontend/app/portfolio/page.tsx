"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    useConnection,
    useWallet,
} from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
    ArrowUpRight,
    Activity,
    ExternalLink,
    RotateCcw,
    Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { AGENTS, formatUsdc } from "@/lib/agents";
import { CLUSTER } from "@/lib/solora";
import {
    runsForWallet,
    totalNotional,
    usePortfolio,
    type PortfolioRun,
} from "@/lib/portfolio-store";
import { shortSig } from "@/lib/devnet-tx";

interface RecentTx {
    signature: string;
    blockTime: number | null;
    err: unknown;
    confirmationStatus: string | null;
}

export default function PortfolioPage() {
    const { connection } = useConnection();
    const { publicKey, connected } = useWallet();
    const { setVisible: setWalletModalVisible } = useWalletModal();
    const allRuns = usePortfolio((s) => s.runs);
    const clearForWallet = usePortfolio((s) => s.clearForWallet);

    const [hydrated, setHydrated] = useState(false);
    const [balanceSol, setBalanceSol] = useState<number | null>(null);
    const [recent, setRecent] = useState<RecentTx[]>([]);
    const [recentLoading, setRecentLoading] = useState(false);

    useEffect(() => setHydrated(true), []);

    const walletPubkey = publicKey?.toBase58();

    useEffect(() => {
        if (!publicKey) {
            setBalanceSol(null);
            setRecent([]);
            return;
        }
        let cancelled = false;
        setRecentLoading(true);

        (async () => {
            try {
                const lamports = await connection.getBalance(publicKey, "confirmed");
                if (!cancelled) setBalanceSol(lamports / LAMPORTS_PER_SOL);
            } catch {
                if (!cancelled) setBalanceSol(null);
            }

            try {
                const sigs = await connection.getSignaturesForAddress(
                    publicKey,
                    { limit: 12 },
                    "confirmed"
                );
                if (!cancelled) {
                    setRecent(
                        sigs.map((s) => ({
                            signature: s.signature,
                            blockTime: s.blockTime ?? null,
                            err: s.err,
                            confirmationStatus: s.confirmationStatus ?? null,
                        }))
                    );
                }
            } catch {
                if (!cancelled) setRecent([]);
            } finally {
                if (!cancelled) setRecentLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [connection, publicKey]);

    const runs = useMemo<PortfolioRun[]>(() => {
        if (!hydrated) return [];
        return runsForWallet(allRuns, walletPubkey);
    }, [allRuns, hydrated, walletPubkey]);

    const totalDelegated = useMemo(
        () => runs.reduce((acc, r) => acc + r.delegatedUsdc, 0),
        [runs]
    );
    const totalNotionalUsdc = useMemo(
        () => runs.reduce((acc, r) => acc + totalNotional(r), 0),
        [runs]
    );
    const totalReceipts = useMemo(
        () => runs.reduce((acc, r) => acc + r.receipts.length, 0),
        [runs]
    );

    const explorerForSig = (sig: string) =>
        `https://explorer.solana.com/tx/${sig}${
            CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`
        }`;
    const explorerForAccount = (pk: string) =>
        `https://explorer.solana.com/address/${pk}${
            CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`
        }`;

    if (!connected || !walletPubkey) {
        return (
            <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-16 sm:pt-20 pb-20">
                <Badge>Portfolio</Badge>
                <h1 className="mt-4 sm:mt-5 text-display-2 text-fg text-balance">
                    Connect a wallet to load your portfolio.
                </h1>
                <p className="mt-4 sm:mt-5 text-[15px] sm:text-[17px] leading-[1.55] text-fg-muted">
                    Soloraa pulls your live SOL balance and recent confirmed
                    transactions from Solana {CLUSTER}, plus every agent run you've
                    executed in this browser (delegation receipt + leg signatures).
                </p>
                <div className="mt-6 sm:mt-7 flex flex-wrap items-center gap-3">
                    <Button onClick={() => setWalletModalVisible(true)}>
                        <Wallet className="size-4" /> Connect wallet
                    </Button>
                    <Link
                        href="/agents"
                        className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg"
                    >
                        Browse agents <ArrowUpRight className="size-3.5" />
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-20 sm:pb-24 lg:pt-20">
            <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-8 sm:pb-10">
                <div>
                    <Badge>Portfolio</Badge>
                    <h1 className="mt-4 sm:mt-5 text-display-2 text-fg break-all">
                        {walletPubkey.slice(0, 4)}…{walletPubkey.slice(-4)}
                    </h1>
                    <p className="mt-2 sm:mt-3 text-[13px] sm:text-[14px] text-fg-muted font-mono break-all">
                        Solana {CLUSTER} ·{" "}
                        <a
                            href={explorerForAccount(walletPubkey)}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-fg"
                        >
                            view on explorer
                        </a>
                    </p>
                </div>
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line w-full sm:w-auto">
                    <Kpi
                        label="SOL balance"
                        value={
                            balanceSol === null
                                ? "—"
                                : `${balanceSol.toFixed(balanceSol > 1 ? 2 : 4)} SOL`
                        }
                    />
                    <Kpi
                        label="Notional moved"
                        value={`${formatUsdc(totalNotionalUsdc)} USDC`}
                        sub={`${totalReceipts} txs`}
                    />
                    <Kpi
                        label="Delegated total"
                        value={`${formatUsdc(totalDelegated)} USDC`}
                        sub={`${runs.length} runs`}
                    />
                </div>
            </header>

            <section className="mt-10 sm:mt-12">
                <header className="mb-5 flex items-baseline justify-between gap-3">
                    <div>
                        <h2 className="text-display-3 text-fg">Agent runs</h2>
                        <p className="mt-2 text-[13.5px] sm:text-[14px] text-fg-muted max-w-2xl">
                            Every successful Soloraa run this wallet has executed in this
                            browser. Each row links to its delegation receipt + every leg.
                        </p>
                    </div>
                    {runs.length > 0 && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => clearForWallet(walletPubkey)}
                            className="shrink-0"
                        >
                            <RotateCcw className="size-3.5" /> Clear
                        </Button>
                    )}
                </header>

                {runs.length === 0 ? (
                    <EmptyState
                        title="No agent runs yet"
                        body={
                            <>
                                Run any agent from{" "}
                                <Link href="/agents" className="text-fg hover:underline">
                                    the library
                                </Link>{" "}
                                — once it confirms, the receipts will appear here for the
                                connected wallet.
                            </>
                        }
                    />
                ) : (
                    <ul className="grid gap-3">
                        {runs.map((run) => {
                            const agent = AGENTS.find((a) => a.id === run.agentId);
                            return (
                                <li key={run.id}>
                                    <Card className="border-line-bright/70">
                                        <CardBody className="p-4 sm:p-5">
                                            <div className="flex flex-wrap items-baseline justify-between gap-3">
                                                <div>
                                                    <p className="text-[14px] font-medium text-fg">
                                                        {run.agentName}
                                                    </p>
                                                    <p className="mt-0.5 text-[12px] text-fg-muted font-mono">
                                                        {new Date(run.completedAt).toLocaleString()} ·{" "}
                                                        {run.receipts.length} confirmed tx{run.receipts.length === 1 ? "" : "s"}
                                                    </p>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                                    <Badge tone="ok">confirmed</Badge>
                                                    <span className="font-mono text-fg-dim">
                                                        cap {formatUsdc(run.delegatedUsdc)} USDC
                                                    </span>
                                                    <span className="font-mono text-fg-dim">
                                                        · notional {formatUsdc(totalNotional(run))} USDC
                                                    </span>
                                                </div>
                                            </div>

                                            <ul className="mt-4 grid gap-2">
                                                {run.receipts.map((r) => (
                                                    <li
                                                        key={r.signature}
                                                        className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-raised/30 px-3 py-2"
                                                    >
                                                        <div className="min-w-0">
                                                            <p className="text-[12.5px] text-fg truncate">
                                                                {r.label}
                                                            </p>
                                                            <p className="mt-0.5 font-mono text-[11px] text-fg-dim truncate">
                                                                {shortSig(r.signature)}
                                                            </p>
                                                        </div>
                                                        <a
                                                            href={r.explorerUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-fg-soft hover:text-fg"
                                                        >
                                                            explorer
                                                            <ExternalLink className="size-3.5" />
                                                        </a>
                                                    </li>
                                                ))}
                                            </ul>

                                            {agent && (
                                                <Link
                                                    href={`/agent/${agent.id}` as never}
                                                    className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-fg-soft hover:text-fg"
                                                >
                                                    Run {agent.name} again
                                                    <ArrowUpRight className="size-3.5" />
                                                </Link>
                                            )}
                                        </CardBody>
                                    </Card>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <section className="mt-10 sm:mt-12">
                <header className="mb-5">
                    <h2 className="text-display-3 text-fg flex items-center gap-2">
                        <Activity className="size-5 text-fg-muted" /> Recent on-chain activity
                    </h2>
                    <p className="mt-2 text-[13.5px] sm:text-[14px] text-fg-muted max-w-2xl">
                        The last 12 confirmed transactions touching this wallet, fetched
                        live from Solana {CLUSTER} RPC.
                    </p>
                </header>

                {recentLoading && recent.length === 0 ? (
                    <EmptyState title="Loading…" body="Querying Solana RPC for recent signatures." />
                ) : recent.length === 0 ? (
                    <EmptyState
                        title="No transactions yet"
                        body="This wallet has no confirmed transactions on the current cluster. Approve a delegation or run any agent to populate this list."
                    />
                ) : (
                    <ul className="rounded-xl border border-line bg-bg-surface/40 divide-y divide-line">
                        {recent.map((r) => {
                            const ok = r.err === null;
                            const when =
                                r.blockTime !== null
                                    ? new Date(r.blockTime * 1000).toLocaleString()
                                    : "—";
                            return (
                                <li
                                    key={r.signature}
                                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5"
                                >
                                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                                        <span
                                            className={`mono-num text-[11.5px] ${
                                                ok ? "text-fg-dim" : "text-danger"
                                            }`}
                                        >
                                            {when}
                                        </span>
                                        <span className="text-fg-soft text-[13px] font-mono truncate">
                                            {shortSig(r.signature)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {ok ? (
                                            <Badge tone="ok">
                                                {r.confirmationStatus ?? "confirmed"}
                                            </Badge>
                                        ) : (
                                            <Badge tone="danger">failed</Badge>
                                        )}
                                        <a
                                            href={explorerForSig(r.signature)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1.5 text-[12px] text-fg-soft hover:text-fg"
                                        >
                                            explorer
                                            <ExternalLink className="size-3.5" />
                                        </a>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="bg-bg-surface px-5 py-4 min-w-[140px]">
            <p className="text-eyebrow text-fg-dim">{label}</p>
            <p className="mt-1.5 mono-num text-[16px] sm:text-[18px] text-fg">{value}</p>
            {sub && <p className="text-[11px] text-fg-dim mono-num mt-0.5">{sub}</p>}
        </div>
    );
}

function EmptyState({
    title,
    body,
}: {
    title: string;
    body: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-line bg-bg-surface/40 px-5 py-8 sm:py-10 text-center">
            <p className="text-[14px] font-medium text-fg">{title}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-muted max-w-md mx-auto">
                {body}
            </p>
        </div>
    );
}
