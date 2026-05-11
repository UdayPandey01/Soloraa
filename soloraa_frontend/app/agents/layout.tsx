import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Agents",
    description:
        "Browse Soloraa's library of attested autonomous agents. Each agent runs under a cryptographic policy verified on Solana.",
};

export default function AgentsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
