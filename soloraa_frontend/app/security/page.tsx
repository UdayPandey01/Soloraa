import type { Metadata } from "next";
import { Hash, Lock, KeyRound, LayoutList, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { CodeBlock, InlineCode } from "@/components/ui/code";
import { IntentBytes } from "@/components/intent-bytes";
import { Solution } from "@/components/solution";

export const metadata: Metadata = {
    title: "Security",
    description:
        "Every guarantee Soloraa makes is mapped to a specific on-chain check and a typed error code.",
};

const GUARANTEES = [
    {
        icon: Hash,
        title: "Replay protection",
        code: "IntentNonceMismatch · 6018",
        file: "programs/solora/src/verify.rs:78",
        body: "Every signed intent commits to wallet.nonce. The on-chain verifier reads the current nonce, compares, and bumps it on success. A resubmit with a fresh blockhash and the same signed bytes lands on the program — and is rejected. Solana's own dedup catches naïve resubmits; Soloraa catches the sophisticated ones.",
    },
    {
        icon: Lock,
        title: "Fork-resistant binding",
        code: "BlockhashMismatch · 6033",
        file: "programs/solora/src/verify.rs:142",
        body: "Signed messages bind a (recent_blockhash, slot) pair. The verifier loads the SysvarS1otHashes account, binary-searches for the signed slot, and compares hashes byte-for-byte. Replays across forks or skipped slots miss the entry.",
    },
    {
        icon: ShieldCheck,
        title: "Enclave signature",
        code: "EnclaveSignerMismatch · 6017",
        file: "programs/solora/src/verify.rs:52",
        body: "An Ed25519Program instruction must immediately precede every execute call. The verifier parses that instruction's payload, extracts the signing key, and rejects unless it equals wallet.enclave_signer.",
    },
    {
        icon: KeyRound,
        title: "Attested rotation",
        code: "AttestationMeasurementMismatch · 6045",
        file: "programs/solora/src/lib.rs:431",
        body: "register_enclave_v2 requires both the wallet authority's signature AND a governor proof citing a measurement currently in the on-chain registry. Neither side alone can rotate the signer.",
    },
    {
        icon: LayoutList,
        title: "CPI allowlist",
        code: "TargetProgramNotAllowed · 6027",
        file: "programs/solora/src/lib.rs:312",
        body: "Even a perfectly-signed intent cannot CPI into a program not in wallet.policy.allowed_programs[16]. The list is authority-controlled and capped at 16 — every entry is an explicit user decision.",
    },
] as const;

export default function SecurityPage() {
    return (
        <div>
            <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 sm:pt-16 pb-10 sm:pb-12 lg:pt-20">
                <header className="max-w-3xl">
                    <Badge>Security</Badge>
                    <h1 className="mt-5 text-display-2 text-fg text-balance">
                        Guarantees that map to code.
                    </h1>
                    <p className="mt-5 text-[17px] leading-[1.55] text-fg-muted">
                        Every constraint Soloraa enforces is a specific check in the
                        Anchor program with a typed error code. The list below is the
                        whole list. If a property isn't on it, the program doesn't
                        check it.
                    </p>
                </header>
            </section>

            <section className="mx-auto max-w-7xl px-4 sm:px-6">
                <div className="rounded-xl border border-line bg-bg-surface/40 p-6 lg:p-8">
                    <p className="text-eyebrow text-fg-dim">Canonical signed intent</p>
                    <p className="mt-2 text-[15px] text-fg-soft max-w-2xl">
                        The 169 bytes the chain verifies. Every field is a single
                        invariant on the agent's behavior.
                    </p>
                    <div className="mt-6">
                        <IntentBytes />
                    </div>
                </div>
            </section>

            <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-20">
                <h2 className="text-display-3 text-fg">Active checks</h2>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    {GUARANTEES.map((g) => (
                        <Card key={g.title} interactive className="h-full">
                            <CardBody className="space-y-4">
                                <header className="flex items-start justify-between gap-3">
                                    <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-bg-raised text-fg-soft">
                                        <g.icon className="size-4" />
                                    </span>
                                    <code className="font-mono text-[11px] text-fg-dim text-right max-w-[60%]">
                                        {g.code}
                                    </code>
                                </header>
                                <div>
                                    <h3 className="text-[15px] font-medium text-fg tracking-tight">
                                        {g.title}
                                    </h3>
                                    <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
                                        {g.body}
                                    </p>
                                    <code className="mt-3 inline-block font-mono text-[11px] text-fg-dim">
                                        {g.file}
                                    </code>
                                </div>
                            </CardBody>
                        </Card>
                    ))}
                </div>
            </section>

            <Solution />

            <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
                <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] items-start">
                    <div>
                        <h2 className="text-display-3 text-fg">Trust model in one paragraph</h2>
                        <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">
                            A user's wallet can only be drained by Ed25519-signed intents
                            from <InlineCode>wallet.enclave_signer</InlineCode>. That signer
                            is rotated only via <InlineCode>register_enclave_v2</InlineCode>,
                            which requires the wallet authority's signature{" "}
                            <span className="text-fg">and</span> a governor-signed proof
                            citing a measurement that's currently in the on-chain registry as{" "}
                            <span className="text-fg">active</span>. Compromise of the agent,
                            relayer, or governor alone cannot move funds. The architecture
                            supports multisig governor and recursive attestation.
                        </p>
                    </div>
                    <CodeBlock title="programs/solora/src/verify.rs" language="rust">
{`// every execute_* instruction passes through this gate.
pub fn verify_enclave_intent(
    instructions_sysvar: &AccountInfo,
    slot_hashes_sysvar: &AccountInfo,
    program_id: &Pubkey,
    wallet_pda: &Pubkey,
    enclave_signer: &Pubkey,
    nonce: u64,
    kind: IntentKind,
    payload_hash: &[u8; 32],
) -> Result<()> {
    // ① Ed25519Program ix immediately precedes us
    let ed_ix = ed25519_ix_at(instructions_sysvar, current_ix - 1)?;
    // ② signing key equals wallet.enclave_signer
    require!(ed_ix.pubkey == *enclave_signer, EnclaveSignerMismatch);
    // ③ 169 bytes parse cleanly into SOLORA_INTENT_V2
    let msg = parse_intent_v2(ed_ix.message)?;
    // ④ bindings: program_id, wallet_pda, nonce, kind, payload_hash
    require!(msg.program_id == *program_id, IntentProgramMismatch);
    require!(msg.wallet_pda == *wallet_pda, IntentWalletMismatch);
    require!(msg.nonce == nonce, IntentNonceMismatch);
    require!(msg.kind == kind, IntentKindMismatch);
    require!(msg.payload_hash == *payload_hash, IntentPayloadMismatch);
    // ⑤ slot hashes match
    verify_blockhash_binding(slot_hashes_sysvar, &msg)?;
    Ok(())
}`}
                    </CodeBlock>
                </div>
            </section>
        </div>
    );
}
