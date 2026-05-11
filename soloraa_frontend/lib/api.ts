import type { PipelineStageId } from "@/lib/solora";

export type StageState = "idle" | "active" | "ok" | "error";
export type RunMode = "mock" | "live";

export type ExecutionEvent = {
    id: string;
    ts: string;
    type: "stage" | "log" | "metric" | "status" | "error";
    message: string;
    stageId?: PipelineStageId;
    stageState?: StageState;
    level?: "info" | "warn" | "error";
    source?: "agent" | "relayer" | "enclave" | "solana";
    data?: Record<string, unknown>;
    txSignature?: string;
    errorCode?: number;
};

export function buildStreamUrl(kind: "agent" | "replay", mode?: RunMode): string {
    const suffix = mode ? `?mode=${mode}` : "";
    if (typeof window === "undefined") {
        return `/api/${kind}/run${suffix}`;
    }
    const url = new URL(`/api/${kind}/run${suffix}`, window.location.origin);
    return url.toString();
}

export async function fetchEnclaveHealth(): Promise<{
    ok: boolean;
    status: number;
    detail?: string;
}> {
    const res = await fetch("/api/enclave/health", { cache: "no-store" });
    const body = await res.json();
    return {
        ok: Boolean(body.ok),
        status: body.status ?? res.status,
        detail: body.detail ?? body.error,
    };
}

export async function fetchEnclavePubkey(): Promise<string | null> {
    const res = await fetch("/api/enclave/pubkey", { cache: "no-store" });
    if (!res.ok) {
        return null;
    }
    const body = await res.json();
    return typeof body.pubkey_base58 === "string" ? body.pubkey_base58 : null;
}
