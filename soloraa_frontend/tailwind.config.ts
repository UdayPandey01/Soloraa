import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: "class",
    content: [
        "./app/**/*.{ts,tsx,mdx}",
        "./components/**/*.{ts,tsx}",
        "./lib/**/*.{ts,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                /* Surface palette — graphite, single-weight borders, no tint. */
                bg: {
                    DEFAULT: "hsl(var(--bg) / <alpha-value>)",
                    surface: "hsl(var(--bg-surface) / <alpha-value>)",
                    raised: "hsl(var(--bg-raised) / <alpha-value>)",
                },
                fg: {
                    DEFAULT: "hsl(var(--fg) / <alpha-value>)",
                    muted: "hsl(var(--fg-muted) / <alpha-value>)",
                    dim: "hsl(var(--fg-dim) / <alpha-value>)",
                    soft: "hsl(var(--fg-soft) / <alpha-value>)",
                },
                line: {
                    DEFAULT: "hsl(var(--line) / <alpha-value>)",
                    bright: "hsl(var(--line-bright) / <alpha-value>)",
                },
                /* The single accent. Used sparingly. */
                accent: "hsl(var(--accent) / <alpha-value>)",
                /* State colors — muted, only for active state moments. */
                ok: "hsl(var(--ok) / <alpha-value>)",
                warn: "hsl(var(--warn) / <alpha-value>)",
                danger: "hsl(var(--danger) / <alpha-value>)",
            },
            fontFamily: {
                sans: ["var(--font-sans)", "system-ui", "sans-serif"],
                mono: ["var(--font-mono)", "ui-monospace", "monospace"],
            },
            fontSize: {
                /* Linear/Vercel-style display sizes — large, tight, but never gimmicky. */
                "display-1": ["clamp(2.75rem, 5.5vw, 4.75rem)", { lineHeight: "1.04", letterSpacing: "-0.035em", fontWeight: "500" }],
                "display-2": ["clamp(2rem, 3.5vw, 3rem)", { lineHeight: "1.08", letterSpacing: "-0.028em", fontWeight: "500" }],
                "display-3": ["clamp(1.375rem, 2vw, 1.875rem)", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "500" }],
                eyebrow: ["0.6875rem", { lineHeight: "1.5", letterSpacing: "0.16em", fontWeight: "500" }],
            },
            keyframes: {
                "fade-up": {
                    "0%": { opacity: "0", transform: "translateY(6px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
                "pulse-soft": {
                    "0%, 100%": { opacity: "0.65" },
                    "50%": { opacity: "1" },
                },
                "blink": {
                    "0%, 100%": { opacity: "0.4" },
                    "50%": { opacity: "1" },
                },
            },
            animation: {
                "fade-up": "fade-up 0.4s cubic-bezier(0.21, 1.02, 0.73, 1) forwards",
                "pulse-soft": "pulse-soft 2.6s ease-in-out infinite",
                "blink": "blink 1.6s ease-in-out infinite",
            },
            boxShadow: {
                "ring-line":
                    "0 0 0 1px hsl(var(--line-bright) / 0.8)",
                "ring-accent":
                    "0 0 0 1px hsl(var(--accent) / 0.5)",
                "card": "0 1px 0 hsl(var(--line) / 0.6) inset",
            },
        },
    },
    plugins: [],
};

export default config;
