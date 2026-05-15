"use client";

import { useEffect, useRef } from "react";

export function CustomCursor() {
    const dotRef = useRef<HTMLDivElement>(null);
    const ringRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const isFinePointer =
            typeof window !== "undefined" &&
            window.matchMedia("(hover: hover) and (pointer: fine)").matches;
        if (!isFinePointer) return;

        document.body.classList.add("landing-cursor-active");

        let mouseX = 0;
        let mouseY = 0;
        let ringX = 0;
        let ringY = 0;
        let raf = 0;

        const onMove = (e: MouseEvent) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            if (dotRef.current) {
                dotRef.current.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0) translate(-50%, -50%)`;
            }
        };

        const tick = () => {
            ringX += (mouseX - ringX) * 0.18;
            ringY += (mouseY - ringY) * 0.18;
            if (ringRef.current) {
                ringRef.current.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
            }
            raf = requestAnimationFrame(tick);
        };

        const onOver = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!ringRef.current) return;
            if (target?.closest('[data-cursor="link"]')) {
                ringRef.current.classList.add("hover");
            } else {
                ringRef.current.classList.remove("hover");
            }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseover", onOver);
        raf = requestAnimationFrame(tick);

        return () => {
            document.body.classList.remove("landing-cursor-active");
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseover", onOver);
            cancelAnimationFrame(raf);
        };
    }, []);

    return (
        <>
            <div ref={dotRef} className="cursor-dot" />
            <div ref={ringRef} className="cursor-ring" />
        </>
    );
}
