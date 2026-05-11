import type { Transition, Variants } from "framer-motion";

/**
 * Shared motion language. Every animated component imports from here so the
 * timing curves stay coherent across the app — there's no "designer's
 * fingerprint" worse than a hero that animates with a 0.4s ease-out and a
 * card grid that uses 1.2s overshoot.
 */

export const SPRING_DEFAULT: Transition = {
    type: "spring",
    stiffness: 200,
    damping: 30,
    mass: 0.8,
};

export const SPRING_GENTLE: Transition = {
    type: "spring",
    stiffness: 120,
    damping: 24,
    mass: 1,
};

export const SPRING_SNAPPY: Transition = {
    type: "spring",
    stiffness: 360,
    damping: 28,
};

export const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1] as const;
export const EASE_IN_QUART = [0.5, 0, 0.75, 0] as const;

export const fadeUp: Variants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: SPRING_DEFAULT },
};

export const fadeIn: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.6, ease: EASE_OUT_QUART } },
};

export const stagger = (delay = 0.06): Variants => ({
    hidden: {},
    visible: {
        transition: { staggerChildren: delay, delayChildren: 0.04 },
    },
});

export const scaleIn: Variants = {
    hidden: { opacity: 0, scale: 0.96 },
    visible: { opacity: 1, scale: 1, transition: SPRING_DEFAULT },
};
