"use client";

export function PageHeroBackdrop({
    tone = "accent",
}: {
    tone?: "accent" | "ok" | "danger" | "neutral";
}) {
    const toneVar = {
        accent: "--accent",
        ok: "--ok",
        danger: "--danger",
        neutral: "--fg",
    }[tone];

    return (
        <div
            className="pointer-events-none absolute inset-0 -z-0 overflow-hidden"
            aria-hidden
        >
            <div
                className="absolute"
                style={{
                    top: "-60%",
                    left: "-30%",
                    width: "120%",
                    height: "180%",
                    background: `radial-gradient(ellipse 50% 40% at 55% 50%, hsl(var(${toneVar}) / 0.18) 0%, hsl(var(${toneVar}) / 0.06) 35%, transparent 70%)`,
                    filter: "blur(140px)",
                    mixBlendMode: "screen",
                }}
            />
            <div
                className="absolute"
                style={{
                    top: "-20%",
                    right: "-40%",
                    width: "140%",
                    height: "160%",
                    background: `radial-gradient(ellipse 45% 55% at 35% 45%, hsl(var(${toneVar}) / 0.09) 0%, transparent 65%)`,
                    filter: "blur(180px)",
                    mixBlendMode: "screen",
                    opacity: 0.85,
                }}
            />
            <div
                className="absolute"
                style={{
                    bottom: "-50%",
                    left: "20%",
                    width: "80%",
                    height: "120%",
                    background:
                        "radial-gradient(ellipse 60% 50% at 50% 30%, hsl(220 60% 18% / 0.45) 0%, transparent 65%)",
                    filter: "blur(160px)",
                    mixBlendMode: "screen",
                }}
            />
            <div
                className="absolute"
                style={{
                    top: "-30%",
                    right: "-10%",
                    width: "60%",
                    height: "90%",
                    background:
                        "radial-gradient(ellipse 40% 60% at 50% 50%, hsl(32 35% 80% / 0.05) 0%, transparent 70%)",
                    filter: "blur(120px)",
                    mixBlendMode: "screen",
                }}
            />
            <div className="grain-cinematic" />
        </div>
    );
}
