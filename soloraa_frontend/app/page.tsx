import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Hero } from "@/components/hero";
import { Problem } from "@/components/problem";
import { Solution } from "@/components/solution";
import { SecurityCards } from "@/components/security-cards";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
    return (
        <div>
            <Hero />
            <Problem />
            <Solution />
            <SecurityCards />
            <FinalCta />
        </div>
    );
}

function FinalCta() {
    return (
        <section className="relative py-20 sm:py-28 lg:py-36 border-t border-line">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
                <div className="rounded-xl border border-line bg-bg-surface/40 p-7 sm:p-10 lg:p-14">
                    <div className="max-w-3xl">
                        <Badge>Get started</Badge>
                        <h2 className="mt-4 sm:mt-5 text-display-2 text-balance text-fg">
                            Run an attested agent in two clicks.
                        </h2>
                        <p className="mt-4 sm:mt-5 text-[15px] sm:text-[17px] leading-[1.55] text-fg-muted">
                            Connect a wallet, delegate a bounded amount, and step through
                            the cryptographic execution lifecycle in real time. Real
                            devnet legs broadcast after the pipeline, and the replay
                            demo is one click away.
                        </p>
                        <div className="mt-7 sm:mt-8 flex flex-wrap items-center gap-3">
                            <Link
                                href="/agents"
                                className="inline-flex items-center gap-2 rounded-md h-11 px-5 text-[14px] font-medium bg-fg text-bg hover:opacity-90"
                            >
                                Browse agents <ArrowRight className="size-4" />
                            </Link>
                            <Link
                                href="/developers"
                                className="inline-flex items-center gap-2 rounded-md h-11 px-5 text-[14px] font-medium bg-bg-surface text-fg border border-line-bright hover:border-fg-dim"
                            >
                                Build your own
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
