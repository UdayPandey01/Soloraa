import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Portfolio",
    description:
        "Live SOL balance, agent runs, and recent on-chain activity for your connected Solana wallet.",
};

export default function PortfolioLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
