import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Box, Cpu, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { CodeBlock, InlineCode } from "@/components/ui/code";

export const metadata: Metadata = {
    title: "Developers",
    description:
        "Build autonomous agents on Soloraa. The @soloraa/sdk handles intent shaping, enclave dispatch, and signed-intent broadcasting.",
};

export default function DevelopersPage() {
    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-20 sm:pb-24 lg:pt-20">
            <header className="max-w-3xl">
                <Badge>Developer platform</Badge>
                <h1 className="mt-5 text-display-2 text-fg text-balance">
                    Any agent that can describe an intent can run on Soloraa.
                </h1>
                <p className="mt-5 text-[17px] leading-[1.55] text-fg-muted">
                    The built-in agents are not a closed set. The{" "}
                    <InlineCode>@soloraa/sdk</InlineCode> exposes the same primitives the
                    catalog uses — describe an action, the enclave signs only what your
                    policy allows, the chain verifies before funds move.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 rounded-md h-11 px-5 text-[14px] font-medium bg-fg text-bg hover:opacity-90"
                    >
                        Read the docs <ArrowRight className="size-4" />
                    </Link>
                    <a
                        href="https://github.com"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-md h-11 px-5 text-[14px] font-medium bg-bg-surface text-fg border border-line-bright hover:border-fg-dim"
                    >
                        SDK source
                    </a>
                </div>
            </header>

            <section className="mt-16">
                <h2 className="text-eyebrow text-fg-dim">Install</h2>
                <div className="mt-3">
                    <CodeBlock title="install" language="bash">
{`npm install @soloraa/sdk
# or
pnpm add @soloraa/sdk`}
                    </CodeBlock>
                </div>
            </section>

            <section className="mt-16">
                <h2 className="text-eyebrow text-fg-dim">Five-line example</h2>
                <p className="mt-3 text-[15px] text-fg-soft max-w-2xl">
                    Submit a swap intent. The enclave reads on-chain wallet state, runs
                    your policy, fetches and verifies the Pyth update, and signs only if
                    every check passes. Your code never sees a private key.
                </p>
                <div className="mt-5">
                    <CodeBlock title="examples/swap.ts" language="ts">
{`import { SoloraaClient } from "@soloraa/sdk";

const client = new SoloraaClient({
    rpcUrl: process.env.SOLANA_RPC_URL!,
    enclaveUrl: process.env.SOLORA_ENCLAVE_URL!,
    walletPda: process.env.SOLORA_WALLET_PDA!,
});

await client.execute({
    action: "swap",
    protocol: "jupiter",
    inputMint: "EPjFW...USDC",
    outputMint: "So111...SOL",
    amount: 1000_000_000n,           // 1000 USDC
    constraints: {
        maxSlippageBps: 25,
    },
});`}
                    </CodeBlock>
                </div>
            </section>

            <section className="mt-16">
                <h2 className="text-display-3 text-fg">What the SDK does for you</h2>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <Card>
                        <CardBody>
                            <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-bg-raised text-fg-soft">
                                <Box className="size-4" />
                            </span>
                            <h3 className="mt-5 text-[14px] font-medium text-fg">
                                Intent shaping
                            </h3>
                            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
                                Your high-level action (swap, transfer, lend, rebalance)
                                becomes a structured intent the enclave can policy-check.
                                Account metas, token mints, decimals — all derived.
                            </p>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardBody>
                            <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-bg-raised text-fg-soft">
                                <Cpu className="size-4" />
                            </span>
                            <h3 className="mt-5 text-[14px] font-medium text-fg">
                                Enclave dispatch
                            </h3>
                            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
                                The SDK calls the enclave HTTP API, receives the
                                canonical 169-byte SOLORA_INTENT_V2 message, the 64-byte
                                Ed25519 signature, and the enclave pubkey.
                            </p>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardBody>
                            <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-bg-raised text-fg-soft">
                                <Webhook className="size-4" />
                            </span>
                            <h3 className="mt-5 text-[14px] font-medium text-fg">
                                Broadcast & stream
                            </h3>
                            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
                                Builds a Solana transaction with the Ed25519 verify ix
                                prepended, signs as the relayer, broadcasts, and streams
                                the lifecycle events back to the caller.
                            </p>
                        </CardBody>
                    </Card>
                </div>
            </section>

            <section className="mt-16">
                <h2 className="text-display-3 text-fg">What the SDK won't let you do</h2>
                <p className="mt-3 text-[15px] text-fg-soft max-w-2xl">
                    These aren't bugs — they're the point.
                </p>
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {[
                        ["Hold a private key", "There is no signing key in user space. The enclave holds the Ed25519 secret sealed to its image hash."],
                        ["Bypass wallet.policy", "The enclave fetches the on-chain policy on every call. Any intent outside it is refused before signing."],
                        ["Reuse a signed intent", "Every intent commits to wallet.nonce. The on-chain verifier rejects with IntentNonceMismatch."],
                        ["Target arbitrary programs", "CPI targets must appear in wallet.policy.allowed_programs. Authority-controlled, capped at 16 entries."],
                    ].map(([title, body]) => (
                        <li
                            key={title}
                            className="rounded-lg border border-line bg-bg-surface/50 px-4 py-3.5"
                        >
                            <p className="text-[13.5px] font-medium text-fg">{title}</p>
                            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                                {body}
                            </p>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="mt-16">
                <h2 className="text-display-3 text-fg">Streaming execution events</h2>
                <p className="mt-3 text-[15px] text-fg-soft max-w-2xl">
                    For long-running agents you'll want the same 7-stage lifecycle the
                    UI shows. <InlineCode>client.stream()</InlineCode> emits typed
                    events so you can wire them into your own observability stack.
                </p>
                <div className="mt-5">
                    <CodeBlock title="examples/stream.ts" language="ts">
{`for await (const event of client.stream({ runId })) {
    switch (event.stage) {
        case "oracle":    metric("oracle.verified", { feed: event.feedId }); break;
        case "sign":      metric("intent.signed", { pubkey: event.pubkey }); break;
        case "verify":
            if (event.error) {
                // event.error.code, event.error.name, event.error.description
                alert("on-chain rejected", event.error);
            } else {
                metric("intent.confirmed", { sig: event.txSignature });
            }
            break;
    }
}`}
                    </CodeBlock>
                </div>
            </section>

            <section className="mt-16 rounded-xl border border-line bg-bg-surface/40 p-8">
                <h3 className="text-[15px] font-medium text-fg">Integration partners</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-fg-muted max-w-2xl">
                    Soloraa is designed to be the cryptographic execution surface
                    between an AI agent and a Solana DeFi protocol. If you maintain a
                    venue or model and want to publish a curated agent, the integration
                    cost is the policy schema and the program allowlist entry.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 rounded-md h-10 px-4 text-sm font-medium border border-line-bright text-fg hover:border-fg-dim"
                    >
                        Integration docs
                    </Link>
                    <a
                        href="mailto:partners@soloraa.dev"
                        className="inline-flex items-center gap-2 rounded-md h-10 px-4 text-sm font-medium text-fg-soft hover:text-fg"
                    >
                        partners@soloraa.dev <ArrowRight className="size-3.5" />
                    </a>
                </div>
            </section>
        </div>
    );
}
