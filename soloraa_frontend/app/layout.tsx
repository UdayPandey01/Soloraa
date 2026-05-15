import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Instrument_Serif } from "next/font/google";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
    subsets: ["latin"],
    weight: "400",
    style: ["normal", "italic"],
    variable: "--font-display",
    display: "swap",
});

export const metadata: Metadata = {
    metadataBase: new URL("https://soloraa.dev"),
    title: {
        default: "Soloraa — Trusted execution for autonomous AI on Solana",
        template: "%s · Soloraa",
    },
    description:
        "Soloraa is the cryptographic execution layer for autonomous AI agents on Solana. Every AI decision is validated inside a TEE, signed under an attested key, and re-verified on-chain before funds move.",
    openGraph: {
        title: "Soloraa",
        description:
            "Trusted execution for autonomous AI on Solana. Cryptographically verified agent infrastructure.",
        type: "website",
    },
    icons: {
        icon: [
            {
                url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='24' y2='24'%3E%3Cstop offset='0%25' stop-color='%239B87FF'/%3E%3Cstop offset='100%25' stop-color='%235EEAD4'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M12 2 L20 7 V17 L12 22 L4 17 V7 Z' stroke='url(%23g)' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E",
                type: "image/svg+xml",
            },
        ],
    },
};

export const viewport: Viewport = {
    themeColor: "#0A0A0F",
    colorScheme: "dark",
};

export default function RootLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <html
            lang="en"
            className={`${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable} dark`}
            suppressHydrationWarning
        >
            <body className="antialiased min-h-screen flex flex-col">
                <SolanaWalletProvider>
                    <Nav />
                    <main className="flex-1">{children}</main>
                    <Footer />
                </SolanaWalletProvider>
            </body>
        </html>
    );
}
