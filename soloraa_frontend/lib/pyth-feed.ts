"use client";

import { useEffect } from "react";
import { create } from "zustand";

const HERMES_URL =
    process.env.NEXT_PUBLIC_PYTH_HERMES_URL ?? "https://hermes.pyth.network";
const SOL_USDC_FEED_ID =
    process.env.NEXT_PUBLIC_PYTH_SOL_USDC_FEED_ID ??
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

const STALE_MS = 30_000;

export interface PythPriceState {
    price: number | null;
    confBps: number | null;
    publishTimeMs: number | null;
    isLive: boolean;
    source: string;
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
    if (typeof window === "undefined") return;

    const url = `${HERMES_URL.replace(/\/$/, "")}/v2/updates/price/stream?ids[]=${SOL_USDC_FEED_ID}&binary=false&parsed=true`;
    try {
        eventSource = new EventSource(url);
    } catch {
        return;
    }
    eventSource.onmessage = (event) => applyUpdate(event.data);
    eventSource.onerror = () => {
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

export function getPythSnapshot(): PythPriceState {
    return usePythStore.getState();
}
