import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Box, Cpu, Webhook } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { CodeBlock, InlineCode } from "@/components/ui/code";
import { PageHeroBackdrop } from "@/components/page-hero-backdrop";

export const metadata: Metadata = {
    title: "Developers",
    description:
        "Build autonomous agents on Soloraa. The @soloraaa/sdk handles intent shaping, enclave dispatch, and signed-intent broadcasting.",
};

export default function DevelopersPage() {
    return (
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-20 sm:pb-24 lg:pt-20 overflow-hidden">
            <PageHeroBackdrop />
            <header className="relative max-w-3xl">
                <p className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.32em] uppercase text-fg-dim">
                    <span
                        className="inline-flex size-1.5 rounded-full animate-pulse"
                        style={{ background: "hsl(var(--ok))" }}
                    />
                    SDK · v0.3.0 · published
                </p>
                <h1
                    className="mt-5 text-[clamp(40px,7vw,84px)] leading-[0.98] tracking-tight text-fg"
                    style={{ fontFamily: "var(--font-display)" }}
                >
                    Any agent that can{" "}
                    <em className="italic text-fg-soft">describe an intent</em>{" "}
                    can run on Soloraa.
                </h1>
                <p className="mt-6 text-[16px] sm:text-[17px] leading-[1.6] text-fg-muted">
                    The built-in agents are not a closed set.{" "}
                    <InlineCode>@soloraaa/sdk</InlineCode> exposes the same primitives
                    the catalogue uses — describe an action, the enclave signs only what
                    your policy allows, the chain verifies before funds move.
                </p>

                <div className="mt-8 rounded-2xl border border-line-bright bg-bg-surface/50 p-5 sm:p-6">
                    <p className="font-mono text-[10.5px] tracking-[0.32em] uppercase text-fg-dim">
                        new in 0.3
                    </p>
                    <p className="mt-3 text-[14.5px] leading-[1.6] text-fg-soft">
                        Zero-setup mode: <InlineCode>new SoloraaClient()</InlineCode>{" "}
                        with no arguments points at the hosted relayer at{" "}
                        <code className="font-mono text-fg">relayer.soloraa.tech</code> —{" "}
                        <em className="italic">install, call, ship</em>. The SDK now talks
                        to the relayer instead of the enclave directly, so consumers
                        don't have to run their own TEE to get started.
                    </p>
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 rounded-full h-11 px-5 text-[14px] font-medium bg-fg text-bg hover:opacity-90 transition-opacity"
                    >
                        Read the docs <ArrowRight className="size-4" />
                    </Link>
                    <a
                        href="https://www.npmjs.com/package/@soloraaa/sdk"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full h-11 px-5 text-[14px] font-medium bg-bg-surface text-fg border border-line-bright hover:border-fg-dim transition-colors"
                    >
                        @soloraaa/sdk on npm
                    </a>
                </div>
            </header>

            <section className="mt-16">
                <h2 className="text-eyebrow text-fg-dim">Install</h2>
                <div className="mt-3">
                    <CodeBlock title="install" language="bash">
{`npm install @soloraaa/sdk @solana/web3.js
# or
pnpm add @soloraaa/sdk @solana/web3.js`}
                    </CodeBlock>
                </div>
            </section>

            <section className="mt-16">
                <h2 className="text-eyebrow text-fg-dim">Five-line example</h2>
                <p className="mt-3 text-[15px] text-fg-soft max-w-2xl">
                    Submit an enclave-signed transfer cycle. The default constructor
                    points at the hosted relayer — no enclave, no keypair, no env vars.
                    Your code never sees a private key.
                </p>
                <div className="mt-5">
                    <CodeBlock title="examples/transfer.ts" language="ts">
{`import { Keypair } from "@solana/web3.js";
import { SoloraaClient } from "@soloraaa/sdk";

const client = new SoloraaClient();

const result = await client.executeTransfer({
    destination: Keypair.generate().publicKey.toBase58(),
    amountLamports: 2_000_000,
});

console.log(result.signature, result.explorerUrl);`}
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
                                Your high-level request (destination, amount, cycle tag)
                                becomes a structured intent the relayer hands to the
                                enclave for policy evaluation and signing.
                            </p>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardBody>
                            <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-bg-raised text-fg-soft">
                                <Cpu className="size-4" />
                            </span>
                            <h3 className="mt-5 text-[14px] font-medium text-fg">
                                Relayer dispatch
                            </h3>
                            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
                                The SDK POSTs to{" "}
                                <code className="font-mono text-fg">/execute-cycle</code> on
                                the relayer. The relayer forwards to the enclave, which
                                produces the 169-byte SOLORA_INTENT_V2 message and the
                                64-byte Ed25519 signature.
                            </p>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardBody>
                            <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-bg-raised text-fg-soft">
                                <Webhook className="size-4" />
                            </span>
                            <h3 className="mt-5 text-[14px] font-medium text-fg">
                                Broadcast & confirm
                            </h3>
                            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
                                The relayer assembles the on-chain transaction (Ed25519
                                verify ix + execute_transfer), signs as the fee payer,
                                submits to Solana, waits for confirmation, and returns
                                the signature + explorer URL.
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
                <h2 className="text-display-3 text-fg">Self-hosting the relayer</h2>
                <p className="mt-3 text-[15px] text-fg-soft max-w-2xl">
                    The hosted relayer at <InlineCode>relayer.soloraa.tech</InlineCode>{" "}
                    is fine for demos and single-tenant trials. For real production,
                    deploy your own relayer + enclave and point the SDK at it.
                </p>
                <div className="mt-5">
                    <CodeBlock title="multi-tenant.ts" language="ts">
{`const client = new SoloraaClient({
    relayerUrl: "https://relayer.my-deployment.com",
    walletAuthority: "<your wallet authority pubkey>",
    agentId: "market-maker-1",
});

await client.executeTransfer({
    destination,
    amountLamports: 2_000_000n,
    cycle: 42,
});`}
                    </CodeBlock>
                </div>
                <p className="mt-4 text-[14px] leading-relaxed text-fg-muted max-w-2xl">
                    The repo's <code className="font-mono text-fg">PRODUCTION_CUTOVER.md</code>{" "}
                    walks the four-phase deployment (local end-to-end → Marlin Oyster
                    CVM → real Jupiter swap intents → mainnet) with commands.
                </p>
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
