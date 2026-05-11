import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { DEMO_VAULT_PUBKEY } from "@/lib/solora";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StageId =
    | "intent"
    | "policy"
    | "oracle"
    | "build"
    | "sign"
    | "broadcast"
    | "verify";

type StageState = "idle" | "active" | "ok" | "error";

type StreamEvent = {
    id: string;
    ts: string;
    type: "stage" | "log" | "status" | "error";
    message: string;
    stageId?: StageId;
    stageState?: StageState;
    level?: "info" | "warn" | "error";
    source?: "agent" | "relayer" | "enclave" | "solana";
    data?: Record<string, unknown>;
    txSignature?: string;
    errorCode?: number;
};

const STAGES: StageId[] = [
    "intent",
    "policy",
    "oracle",
    "build",
    "sign",
    "broadcast",
    "verify",
];

export async function GET(req: NextRequest) {
    const modeParam = req.nextUrl.searchParams.get("mode");
    const mode =
        modeParam === "live" || modeParam === "mock"
            ? modeParam
            : (process.env.SOLORA_FRONTEND_MODE ?? "mock");
    const isLive = mode === "live";

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            const timeouts: NodeJS.Timeout[] = [];
            const stageState: Record<StageId, StageState> = {
                intent: "idle",
                policy: "idle",
                oracle: "idle",
                build: "idle",
                sign: "idle",
                broadcast: "idle",
                verify: "idle",
            };

            const send = (event: Omit<StreamEvent, "id" | "ts">) => {
                const payload: StreamEvent = {
                    id: randomUUID(),
                    ts: new Date().toISOString(),
                    ...event,
                };
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
                );
            };

            let scheduledDone = false;
            let opsRunning = false;

            const tryClose = () => {
                if (scheduledDone && !opsRunning) {
                    controller.close();
                }
            };

            const pushStage = (id: StageId, state: StageState, message: string) => {
                stageState[id] = state;
                send({ type: "stage", stageId: id, stageState: state, message });
            };

            const schedule = (delayMs: number, fn: () => void) => {
                const handle = setTimeout(fn, delayMs);
                timeouts.push(handle);
            };

            send({ type: "status", message: "stream_open", source: "agent" });

            const steps = [
                {
                    id: "intent" as StageId,
                    message: "Intent received",
                    log: "intent created from agent request",
                    source: "agent" as const,
                    duration: 700,
                },
                {
                    id: "policy" as StageId,
                    message: "Policy evaluated",
                    log: "policy gates cleared",
                    source: "enclave" as const,
                    duration: 900,
                },
                {
                    id: "oracle" as StageId,
                    message: "Oracle verified",
                    log: "pyth update verified via wormhole quorum",
                    source: "enclave" as const,
                    duration: 900,
                },
                {
                    id: "build" as StageId,
                    message: "Canonical message built",
                    log: "169-byte intent constructed",
                    source: "enclave" as const,
                    duration: 800,
                },
                {
                    id: "sign" as StageId,
                    message: "Enclave signature produced",
                    log: "sealed ed25519 key signed intent",
                    source: "enclave" as const,
                    duration: 700,
                },
                {
                    id: "broadcast" as StageId,
                    message: "Transaction assembled",
                    log: "ed25519 verify ix + execute ix",
                    source: "relayer" as const,
                    duration: 800,
                },
                {
                    id: "verify" as StageId,
                    message: "On-chain verification complete",
                    log: "nonce bumped and tx confirmed",
                    source: "solana" as const,
                    duration: 900,
                },
            ];

            let timeline = 200;
            const mockSig = "5m2eL1Pz6u3Sbq3kL4vC8e7B3wC5nq6v6sW87TnJ3QpX";

            for (const step of steps) {
                schedule(timeline, () => pushStage(step.id, "active", step.message));
                schedule(timeline + 220, () =>
                    send({
                        type: "log",
                        message: step.log,
                        level: "info",
                        source: step.source,
                    })
                );
                schedule(timeline + step.duration, () =>
                    pushStage(step.id, "ok", step.message)
                );
                if (step.id === "broadcast") {
                    schedule(timeline + step.duration - 120, () =>
                        send({
                            type: "status",
                            message: "tx_signature",
                            txSignature: mockSig,
                            source: "relayer",
                        })
                    );
                }
                timeline += step.duration + 200;
            }

            schedule(timeline + 200, () => {
                scheduledDone = true;
                send({
                    type: "status",
                    message: isLive ? "pipeline_complete" : "run_complete",
                    source: "solana",
                });
                tryClose();
            });

            if (mode === "live") {
                opsRunning = true;
                const stopOps = startOpsStream(send, false, (result) => {
                    opsRunning = false;
                    send({
                        type: "status",
                        message: result === "ok" ? "run_complete" : "run_failed",
                        source: "relayer",
                    });
                    tryClose();
                });
                req.signal.addEventListener("abort", () => {
                    stopOps();
                });
            }

            req.signal.addEventListener("abort", () => {
                timeouts.forEach((t) => clearTimeout(t));
                controller.close();
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}

function startOpsStream(
    send: (event: Omit<StreamEvent, "id" | "ts">) => void,
    replay: boolean,
    onDone: (result: "ok" | "error") => void
) {
    const repoRoot = path.resolve(process.cwd(), "..");
    const opsRelPath = process.env.SOLORA_OPS_TS_PATH ?? "../solora_relayer/ops.ts";
    const opsPath = path.resolve(process.cwd(), opsRelPath);
    const relayerDir = path.resolve(repoRoot, "solora_relayer");

    const destination =
        process.env.SOLORA_FRONTEND_DESTINATION ?? DEMO_VAULT_PUBKEY;

    const args = [
        "--prefix",
        relayerDir,
        "tsx",
        opsPath,
        "transfer",
        "--destination",
        destination,
        "--amount",
        "1000000",
    ];
    if (replay) {
        args.push("--replay");
    }

    const child = spawn("npx", args, {
        cwd: repoRoot,
        env: {
            ...process.env,
        },
    });

    let buffer = "";
    const onLine = (line: string) => {
        if (!line.trim()) return;
        try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (typeof parsed.event === "string") {
                send({
                    type: "log",
                    message: parsed.event as string,
                    level: (parsed.level as any) ?? "info",
                    source: "relayer",
                    data: parsed,
                });
            }
            if (typeof parsed.signature === "string") {
                send({
                    type: "status",
                    message: "tx_signature",
                    txSignature: parsed.signature as string,
                    source: "relayer",
                });
            }
        } catch {
            send({ type: "log", message: line, level: "info", source: "relayer" });
        }
    };

    child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        let index = buffer.indexOf("\n");
        while (index >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            onLine(line);
            index = buffer.indexOf("\n");
        }
    });

    child.stderr.on("data", (chunk) => {
        const line = chunk.toString();
        send({ type: "log", message: line, level: "warn", source: "relayer" });
    });

    child.on("close", () => {
        onDone("ok");
    });

    child.on("error", (err) => {
        send({
            type: "error",
            message: `ops.ts failed: ${String(err)}`,
            level: "error",
            source: "relayer",
        });
        onDone("error");
    });

    return () => {
        child.kill();
    };
}
