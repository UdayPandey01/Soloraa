"use client";

/**
 * Soft ambient backdrop for internal-page headers. A single very-blurred
 * indigo blob + a thin grain layer — gives the hero a designed feel without
 * borrowing the landing page's full marketing aesthetic (mesh, parallax,
 * editorial typography). Drop it as a sibling immediately above any
 * page-level <header> and the parent should be `relative overflow-hidden`.
 */
export function PageHeroBackdrop({
    tone = "accent",
}: {
    /** Color the soft blob in. Defaults to the page's accent indigo. */
    tone?: "accent" | "ok" | "danger" | "neutral";
}) {
    const colors = {
        accent: "hsl(var(--accent) / 0.18)",
        ok: "hsl(var(--ok) / 0.18)",
        danger: "hsl(var(--danger) / 0.18)",
        neutral: "hsl(var(--fg) / 0.10)",
    } as const;

    return (
        <div
            className="pointer-events-none absolute inset-0 -z-0 overflow-hidden"
            aria-hidden
        >
            <div
                className="absolute -top-32 -left-32 w-[60%] aspect-square rounded-full"
                style={{
                    background: `radial-gradient(circle, ${colors[tone]} 0%, transparent 70%)`,
                    filter: "blur(80px)",
                }}
            />
            <div
                className="absolute -bottom-40 right-0 w-[50%] aspect-square rounded-full opacity-60"
                style={{
                    background: `radial-gradient(circle, hsl(var(--fg-muted) / 0.08) 0%, transparent 70%)`,
                    filter: "blur(100px)",
                }}
            />
            <div
                className="absolute inset-0 mix-blend-overlay"
                style={{
                    opacity: 0.04,
                    backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
                }}
            />
        </div>
    );
}
