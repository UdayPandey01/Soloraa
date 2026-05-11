import Link from "next/link";
import { CLUSTER, PROGRAM_ID } from "@/lib/solora";

export function Footer() {
    return (
        <footer className="mt-32 border-t border-line/60">
            <div className="mx-auto max-w-7xl px-6 py-10">
                <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
                    <div>
                        <p className="text-sm text-fg leading-relaxed max-w-sm">
                            Soloraa is the cryptographic execution layer for autonomous
                            AI agents on Solana. Funds move only when an attested enclave
                            signs an intent that the chain independently re-verifies.
                        </p>
                        <p className="mt-3 font-mono text-[11px] text-fg-dim">
                            program {PROGRAM_ID.slice(0, 8)}…{PROGRAM_ID.slice(-6)} · {CLUSTER}
                        </p>
                    </div>
                    <FooterColumn title="Product">
                        <FooterLink href="/agents">Run an agent</FooterLink>
                        <FooterLink href="/replay-demo">Replay attack demo</FooterLink>
                        <FooterLink href="/portfolio">Portfolio</FooterLink>
                    </FooterColumn>
                    <FooterColumn title="Protocol">
                        <FooterLink href="/security">Verification flow</FooterLink>
                        <FooterLink href="/security#guarantees">Guarantees</FooterLink>
                        <FooterLink href="/security#trust-model">Trust model</FooterLink>
                    </FooterColumn>
                    <FooterColumn title="Reference">
                        <FooterLink href="/developers">Developers</FooterLink>
                        <FooterLink href="/docs">SDK reference</FooterLink>
                        <FooterLink href="/security">Threat model</FooterLink>
                    </FooterColumn>
                </div>
                <div className="mt-10 pt-6 border-t border-line/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <p className="text-xs text-fg-dim">
                        Built for autonomous treasuries, AI funds, and DAOs that need
                        execution boundaries that don't depend on code review.
                    </p>
                    <p className="font-mono text-[11px] text-fg-dim">SOLORA_INTENT_V2 · 169 BYTES</p>
                </div>
            </div>
        </footer>
    );
}

function FooterColumn({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <h4 className="text-eyebrow text-fg-dim mb-3">{title}</h4>
            <ul className="space-y-2">{children}</ul>
        </div>
    );
}

function FooterLink({
    href,
    external,
    children,
}: {
    href: string;
    external?: boolean;
    children: React.ReactNode;
}) {
    return (
        <li>
            <Link
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
                className="text-sm text-fg-muted hover:text-fg transition-colors"
            >
                {children}
            </Link>
        </li>
    );
}
