"use client";

import { useEffect } from "react";
import { create } from "zustand";

/**
 * Live Pyth Hermes price subscription.
 *
 * Pyth publishes SOL/USDC (and every other feed) over Wormhole; Hermes is
 * the HTTP/SSE gateway in front of that. We open one EventSource per page
 * load, fan it out to every subscriber via a Zustand store, and refcount
 * teardown so the connection closes when the last consumer unmounts.
 *
 * On error, EventSource auto-reconnects. We also enforce a freshness
 * window: if no update lands for STALE_MS, `isLive` flips to false and
 * downstream consumers (strategies, UI) treat the feed as unavailable.
 */

const HERMES_URL =
    process.env.NEXT_PUBLIC_PYTH_HERMES_URL ?? "https://hermes.pyth.network";
const SOL_USDC_FEED_ID =
    process.env.NEXT_PUBLIC_PYTH_SOL_USDC_FEED_ID ??
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

const STALE_MS = 30_000;

export interface PythPriceState {
    /** SOL price in USDC (e.g. 142.34). null until the first update lands. */
    price: number | null;
    /** Confidence interval expressed in basis points of the price. */
    confBps: number | null;
    /** Pyth-side publish timestamp in ms since epoch. */
    publishTimeMs: number | null;
    /** True iff the feed delivered an update within STALE_MS. */
    isLive: boolean;
    /** Resolved Hermes URL — surfaced in the UI for trust. */
    source: string;
    /** Feed ID — surfaced in the UI for trust. */
    feedId: string;
}

const initialState: PythPriceState = {
    price: null,
    confBps: null,
    publishTimeMs: null,
    isLive: false,
    source: HERMES_URL,
    feedId: SOL_USDC_FEED_ID,
};

const usePythStore = create<PythPriceState>(() => initialState);

let eventSource: EventSource | null = null;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
let refCount = 0;

function markStale() {
    if (usePythStore.getState().isLive) {
        usePythStore.setState({ isLive: false });
    }
}

function resetStaleTimer() {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(markStale, STALE_MS);
}

interface HermesUpdate {
    parsed?: Array<{
        id: string;
        price?: {
            price: string;
            conf: string;
            expo: number;
            publish_time: number;
        };
    }>;
}

function applyUpdate(raw: string) {
    let parsed: HermesUpdate;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return;
    }
    const feed = parsed.parsed?.find(
        (p) => p.id?.replace(/^0x/, "") === SOL_USDC_FEED_ID
    );
    if (!feed?.price) return;

    const rawPrice = Number(feed.price.price);
    const rawConf = Number(feed.price.conf);
    const expo = feed.price.expo;
    if (!Number.isFinite(rawPrice) || !Number.isFinite(expo)) return;

    const scale = Math.pow(10, expo);
    const price = rawPrice * scale;
    const conf = rawConf * scale;
    if (price <= 0) return;
    const confBps = (conf / price) * 10_000;
    const publishTimeMs = feed.price.publish_time * 1_000;

    usePythStore.setState({
        price,
        confBps,
        publishTimeMs,
        isLive: true,
    });
    resetStaleTimer();
}

function ensureSubscribed() {
    if (eventSource) return;
    if (typeof window === "undefined") return; // SSR no-op

    const url = `${HERMES_URL.replace(/\/$/, "")}/v2/updates/price/stream?ids[]=${SOL_USDC_FEED_ID}&binary=false&parsed=true`;
    try {
        eventSource = new EventSource(url);
    } catch {
        // EventSource not available (very old browsers); leave isLive false.
        return;
    }
    eventSource.onmessage = (event) => applyUpdate(event.data);
    eventSource.onerror = () => {
        // EventSource auto-reconnects on error; we just mark stale so the UI
        // reflects the gap until data resumes.
        markStale();
    };
    resetStaleTimer();
}

function teardown() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (staleTimer) {
        clearTimeout(staleTimer);
        staleTimer = null;
    }
    usePythStore.setState(initialState);
}

/**
 * Subscribe a React component to the live Pyth SOL/USDC feed. The first
 * subscriber opens the EventSource; the last unsubscriber closes it.
 */
export function usePythPrice(): PythPriceState {
    useEffect(() => {
        refCount += 1;
        ensureSubscribed();
        return () => {
            refCount -= 1;
            if (refCount <= 0) {
                refCount = 0;
                teardown();
            }
        };
    }, []);
    return usePythStore();
}

/** Read-only snapshot without subscribing. For use inside non-React code. */
export function getPythSnapshot(): PythPriceState {
    return usePythStore.getState();
}
