import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, InlineCode } from "@/components/ui/code";

export const metadata: Metadata = {
    title: "Docs",
    description:
        "Soloraa SDK reference. Construct a client, execute transfer intents, verify signatures locally.",
};

const TOC = [
    { id: "quickstart", label: "Quickstart" },
    { id: "client", label: "Client" },
    { id: "execute", label: "executeTransfer()" },
    { id: "verify", label: "verifyIntent()" },
    { id: "diagnostics", label: "health() & keys()" },
    { id: "errors", label: "Errors" },
    { id: "deployment", label: "Deployment" },
];

export default function DocsPage() {
    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-20 sm:pb-24 lg:pt-20">
            <div className="grid gap-10 sm:gap-12 lg:grid-cols-[200px_1fr]">
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
                            SDK · v0.3.0 · reference
                        </p>
                        <h1
                            className="mt-5 text-[clamp(36px,6vw,72px)] leading-[0.98] tracking-tight text-fg"
                            style={{ fontFamily: "var(--font-display)" }}
                        >
                            <em className="italic text-fg-soft">@</em>soloraaa<em className="italic text-fg-soft">/</em>sdk
                        </h1>
                        <p className="mt-5 text-[15px] sm:text-[16px] leading-[1.6] text-fg-muted">
                            Thin TypeScript client over the Soloraa relayer. Submit
                            transfer cycles, verify signatures locally with real
                            Ed25519, ship a bot in 5 lines.
                        </p>
                    </header>

                    <Section id="quickstart" title="Quickstart">
                        <CodeBlock title="install" language="bash">
{`npm install @soloraaa/sdk @solana/web3.js`}
                        </CodeBlock>
                        <CodeBlock title="my-agent.ts" language="ts" className="mt-3">
{`import { Keypair } from "@solana/web3.js";
import { SoloraaClient } from "@soloraaa/sdk";

// Zero-config: hits the hosted relayer at relayer.soloraa.tech (devnet).
const client = new SoloraaClient();

const result = await client.executeTransfer({
    destination: Keypair.generate().publicKey.toBase58(),
    amountLamports: 2_000_000, // ≥ rent-exempt minimum
});

console.log(result.signature);    // confirmed devnet tx
console.log(result.explorerUrl);  // ready-to-open explorer link
console.log(result.nonceBefore);  // wallet nonce pre-bump`}
                        </CodeBlock>
                    </Section>

                    <Section id="client" title="Client">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            <InlineCode>SoloraaClient</InlineCode> talks to a relayer
                            URL. The relayer forwards to the enclave, which holds the
                            sealed Ed25519 key. The client never holds any signing
                            authority over funds.
                        </p>
                        <CodeBlock title="constructor" language="ts">
{`new SoloraaClient(config?: {
    relayerUrl?: string,            // default: https://relayer.soloraa.tech
    walletAuthority?: string,       // pubkey owning the wallet PDA
    agentId?: string,               // logged on the relayer
    fetchImpl?: typeof fetch,       // inject custom fetch
});`}
                        </CodeBlock>
                        <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
                            Pass <InlineCode>walletAuthority</InlineCode> when running
                            against your own relayer. Leave it unset for the hosted
                            single-tenant demo — the relayer uses its configured default.
                        </p>
                    </Section>

                    <Section id="execute" title="executeTransfer()">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            Submit a transfer cycle: the relayer asks the enclave to
                            sign a 169-byte SOLORA_INTENT_V2 message, then submits
                            <InlineCode>execute_transfer</InlineCode> on chain. Blocks
                            until Solana reaches confirmed commitment.
                        </p>
                        <CodeBlock title="signature" language="ts">
{`client.executeTransfer(req: TransferRequest): Promise<ExecutionResult>

type TransferRequest = {
    destination: string | PublicKey;
    amountLamports: bigint | number;
    cycle?: number;
};

type ExecutionResult = {
    signature: string;     // confirmed tx
    explorerUrl: string;   // pre-built explorer link
    nonceBefore: string;   // wallet nonce as of the signing
    cycle?: number;        // echoed from the request
};`}
                        </CodeBlock>
                        <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
                            <strong className="text-fg">Amount minimum:</strong>{" "}
                            Solana requires receiving accounts to maintain a
                            rent-exempt balance (~890,880 lamports). Send ≥
                            2,000,000 lamports to a fresh destination, or reuse one
                            that already holds SOL.
                        </p>
                    </Section>

                    <Section id="verify" title="verifyIntent()">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            Locally re-verify a (message, signature, pubkey) triple.
                            Runs a real Ed25519 check via{" "}
                            <InlineCode>@noble/ed25519</InlineCode> — never trusts the
                            enclave's word on its own signature. Useful for replay
                            tooling, audit logs, observer pipelines.
                        </p>
                        <CodeBlock title="signature" language="ts">
{`client.verifyIntent(input: {
    message: Uint8Array;    // 169 bytes
    signature: Uint8Array;  // 64 bytes
    enclavePubkey: string;  // base58
}): Promise<VerifyResult>

type VerifyResult =
  | { ok: true; fields: IntentFields }
  | { ok: false; reason: "wrong_length" | "wrong_domain" | "bad_signature" };`}
                        </CodeBlock>
                    </Section>

                    <Section id="diagnostics" title="health() & keys()">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            Two lightweight calls for liveness checks and key discovery.
                        </p>
                        <CodeBlock title="diagnostics" language="ts">
{`await client.health();
// → { status: "ok", programId: "8tkBct...", cluster: "devnet" }

await client.keys();
// → { authority: "B4D6y...", enclavePubkey: "CNBCY3..." }`}
                        </CodeBlock>
                        <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
                            <code className="font-mono">keys().enclavePubkey</code> is
                            fetched live from the relayer — handy if you've redeployed
                            the enclave and need the new pubkey before re-registering
                            it on the wallet PDA.
                        </p>
                    </Section>

                    <Section id="errors" title="Errors">
                        <p className="text-[14px] leading-relaxed text-fg-muted">
                            On-chain rejections throw <InlineCode>SoloraaExecutionError</InlineCode>{" "}
                            with <InlineCode>code</InlineCode>, <InlineCode>errorName</InlineCode>,
                            and a <InlineCode>docUrl</InlineCode> that points at the
                            right error page.
                        </p>
                        <CodeBlock title="catch" language="ts" className="mb-4">
{`import { SoloraaExecutionError } from "@soloraaa/sdk";

try {
    await client.executeTransfer({ destination, amountLamports: 2_000_000n });
} catch (err) {
    if (err instanceof SoloraaExecutionError) {
        console.error(err.code, err.errorName, err.docUrl);
        // 6018  IntentNonceMismatch  https://docs.soloraa.dev/errors/intent-nonce-mismatch
    }
}`}
                        </CodeBlock>
                        <div className="overflow-hidden rounded-xl border border-line">
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
                            By default the SDK uses the hosted relayer at{" "}
                            <code className="font-mono text-fg">relayer.soloraa.tech</code>{" "}
                            (devnet, single-tenant shared wallet). For real production,
                            run your own relayer + enclave and point the SDK at it.
                            The repo's <code className="font-mono text-fg">PRODUCTION_CUTOVER.md</code>{" "}
                            walks the four phases with exact commands.
                        </p>
                        <Link
                            href="/developers"
                            className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-fg-soft hover:text-fg"
                        >
                            Back to the developers overview →
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
