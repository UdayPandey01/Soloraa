import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, InlineCode } from "@/components/ui/code";

export const metadata: Metadata = {
    title: "Docs",
    description:
        "Soloraa SDK reference. Construct a client, execute intents, stream events.",
};

const TOC = [
    { id: "quickstart", label: "Quickstart" },
    { id: "client", label: "Client" },
    { id: "execute", label: "execute()" },
    { id: "verify", label: "verifyIntent()" },
    { id: "stream", label: "stream()" },
    { id: "errors", label: "Errors" },
    { id: "deployment", label: "Deployment" },
];

export default function DocsPage() {
    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-20 sm:pb-24 lg:pt-20">
            <div className="grid gap-10 sm:gap-12 lg:grid-cols-[200px_1fr]">
                {/* Sidebar */}
                <aside className="lg:sticky lg:top-20 lg:self-start">
                    <p className="text-eyebrow text-fg-dim mb-3">Reference</p>
                    <ul className="space-y-1.5">
                        {TOC.map((item) => (
                            <li key={item.id}>
                                <a
                                    href={`#${item.id}`}
                                    className="block text-[13px] text-fg-muted hover:text-fg transition-colors"
                                >
                                    {item.label}
                                </a>
                            </li>
                        ))}
                    </ul>
                </aside>

                <article className="space-y-16 max-w-3xl">
                    <header>
                        <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-fg-dim">
                            SDK · v0.2.0 · reference
                        </p>
                        <h1
                            className="mt-5 text-[clamp(36px,6vw,72px)] leading-[0.98] tracking-tight text-fg"
                            style={{ fontFamily: "var(--font-display)" }}
                        >
                            <em className="italic text-fg-soft">@</em>soloraaa<em className="italic text-fg-soft">/</em>sdk
                        </h1>
                        <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.6] text-fg-muted">
                            A thin TypeScript client over the Soloraa enclave HTTP API
                            and the on-chain program. Submits structured intents, returns
                            verified results, exposes a streaming surface for long
                            sessions.
                        </p>
                    </header>

                    <Section id="quickstart" title="Quickstart">
                        <CodeBlock title="install" language="bash">
{`npm install @soloraaa/sdk @solana/web3.js`}
                        </CodeBlock>
                        <CodeBlock title="my-agent.ts" language="ts" className="mt-3">
{`import { SoloraaClient } from "@soloraaa/sdk";

const client = new SoloraaClient({
    rpcUrl: "https://api.devnet.solana.com",
    enclaveUrl: "http://127.0.0.1:8080",
    walletPda: "3Kh6Y1aeEE9Ss2wbR5DK24KJTDHJf3SZq7sWJkkzKR6N",
});

const result = await client.execute({
    action: "transfer",
    destination: "B4D6...8nqb",
    amount: 1_000_000n,
});

console.log("confirmed", result.signature, "nonce", result.walletNonce);`}
                        </CodeBlock>
                    </Section>

                    <Section id="client" title="Client">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            The <InlineCode>SoloraaClient</InlineCode> holds the three
                            endpoints it needs and the wallet it acts on behalf of. The
                            client carries no signing keys — every signature comes from
                            the enclave.
                        </p>
                        <CodeBlock title="constructor" language="ts">
{`new SoloraaClient({
    rpcUrl: string,         // Solana RPC
    enclaveUrl: string,     // /sign-* endpoints
    walletPda: string,      // base58
    relayerKeypair?: Keypair, // optional: pays tx fees + broadcasts
});`}
                        </CodeBlock>
                    </Section>

                    <Section id="execute" title="execute()">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            Submit an intent, get a confirmed transaction back. Each
                            action maps to a structured request the enclave can policy-check.
                        </p>
                        <CodeBlock title="signature" language="ts">
{`client.execute(intent: ExecutionIntent): Promise<ExecutionResult>

type ExecutionIntent =
  | { action: "transfer"; destination: string; amount: bigint }
  | {
      action: "swap";
      protocol: "jupiter";
      inputMint: string;
      outputMint: string;
      amount: bigint;
      constraints?: { maxSlippageBps?: number };
    }
  | {
      action: "lend";
      protocol: "kamino" | "marginfi" | "solend";
      mint: string;
      amount: bigint;
    };

type ExecutionResult = {
    signature: string;       // confirmed tx signature
    walletNonce: number;     // post-execution
    bytesSigned: Uint8Array; // 169-byte SOLORA_INTENT_V2
};`}
                        </CodeBlock>
                    </Section>

                    <Section id="verify" title="verifyIntent()">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            Reverse-direction check: given a 169-byte signed intent and
                            the enclave pubkey, confirm it would pass the on-chain
                            verifier. Useful for tooling that observes intents without
                            broadcasting.
                        </p>
                        <CodeBlock title="signature" language="ts">
{`client.verifyIntent(args: {
    message: Uint8Array;    // 169 bytes
    signature: Uint8Array;  // 64 bytes
    enclavePubkey: string;  // base58
}): Promise<VerifyResult>

type VerifyResult =
  | { ok: true; fields: IntentFields }
  | { ok: false; reason: IntentRejectReason };`}
                        </CodeBlock>
                    </Section>

                    <Section id="stream" title="stream()">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            Subscribe to lifecycle events for a long-running agent. The
                            stream yields typed events from each of the seven pipeline
                            stages. Backed by Server-Sent Events.
                        </p>
                        <CodeBlock title="usage" language="ts">
{`for await (const event of client.stream({ runId })) {
    if (event.stage === "verify" && event.error) {
        // typed error code from the on-chain program
        console.error(event.error.code, event.error.name);
    }
}`}
                        </CodeBlock>
                    </Section>

                    <Section id="errors" title="Errors">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            On-chain rejections surface as typed errors. Codes match the
                            program's <InlineCode>error.rs</InlineCode>.
                        </p>
                        <div className="mt-4 overflow-hidden rounded-xl border border-line">
                            <table className="w-full text-[13px]">
                                <thead className="bg-bg-surface/50 text-fg-dim font-mono text-[10.5px] uppercase tracking-wider">
                                    <tr className="text-left">
                                        <th className="px-4 py-2.5 font-medium">Code</th>
                                        <th className="px-4 py-2.5 font-medium">Name</th>
                                        <th className="px-4 py-2.5 font-medium">Meaning</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {ERROR_ROWS.map((r) => (
                                        <tr key={r.code}>
                                            <td className="px-4 py-3 mono-num text-fg-soft">{r.code}</td>
                                            <td className="px-4 py-3 font-mono text-[12px] text-fg">
                                                {r.name}
                                            </td>
                                            <td className="px-4 py-3 text-fg-muted">{r.meaning}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Section>

                    <Section id="deployment" title="Deployment">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            The frontend and SDK both target the same on-chain program.
                            See the repo's deployment runbook for the exact commands to
                            stand up devnet infrastructure.
                        </p>
                        <Link
                            href="/developers#deployment"
                            className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-fg-soft hover:text-fg"
                        >
                            See the deployment runbook →
                        </Link>
                    </Section>
                </article>
            </div>
        </div>
    );
}

function Section({
    id,
    title,
    children,
}: {
    id: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section id={id} className="scroll-mt-20">
            <h2 className="text-display-3 text-fg">{title}</h2>
            <div className="mt-4 space-y-4">{children}</div>
        </section>
    );
}

const ERROR_ROWS = [
    { code: 6000, name: "WalletPaused", meaning: "Wallet authority has paused execution." },
    { code: 6017, name: "EnclaveSignerMismatch", meaning: "Ed25519 ix signer ≠ wallet.enclave_signer." },
    { code: 6018, name: "IntentNonceMismatch", meaning: "Replay rejected — nonce stale." },
    { code: 6019, name: "IntentExpired", meaning: "Signed intent expiry passed." },
    { code: 6021, name: "IntentPayloadMismatch", meaning: "Destination, amount, or accounts altered." },
    { code: 6027, name: "TargetProgramNotAllowed", meaning: "CPI target not in allowlist." },
    { code: 6033, name: "BlockhashMismatch", meaning: "Slot/hash not in SlotHashes." },
    { code: 6037, name: "MeasurementRevoked", meaning: "Enclave measurement revoked by governance." },
    { code: 6045, name: "AttestationMeasurementMismatch", meaning: "Attestation cites unknown measurement." },
    { code: 6046, name: "AttestationGovernorMismatch", meaning: "Attestation signed by non-governor key." },
];
