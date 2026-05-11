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

            const schedule = (delayMs: number, fn: () => void) => {
                const handle = setTimeout(fn, delayMs);
                timeouts.push(handle);
            };

            send({ type: "status", message: "stream_open", source: "agent" });

            const steps = [
                {
                    id: "intent" as StageId,
                    message: "Intent received",
                    log: "intent created from previous payload",
                    source: "agent" as const,
                    duration: 700,
                },
                {
                    id: "policy" as StageId,
                    message: "Policy evaluated",
                    log: "policy gates ok, replay attempt continues",
                    source: "enclave" as const,
                    duration: 800,
                },
                {
                    id: "oracle" as StageId,
                    message: "Oracle verified",
                    log: "pyth update reused, still valid",
                    source: "enclave" as const,
                    duration: 800,
                },
                {
                    id: "build" as StageId,
                    message: "Canonical message built",
                    log: "message identical to previous signed intent",
                    source: "relayer" as const,
                    duration: 700,
                },
                {
                    id: "sign" as StageId,
                    message: "Signature reused",
                    log: "replay uses captured signature",
                    source: "relayer" as const,
                    duration: 600,
                },
                {
                    id: "broadcast" as StageId,
                    message: "Replay broadcast",
                    log: "transaction resubmitted to validator",
                    source: "relayer" as const,
                    duration: 800,
                },
            ];

            let timeline = 200;

            for (const step of steps) {
                schedule(timeline, () =>
                    send({
                        type: "stage",
                        stageId: step.id,
                        stageState: "active",
                        message: step.message,
                    })
                );
                schedule(timeline + 200, () =>
                    send({
                        type: "log",
                        message: step.log,
                        level: "info",
                        source: step.source,
                    })
                );
                schedule(timeline + step.duration, () =>
                    send({
                        type: "stage",
                        stageId: step.id,
                        stageState: "ok",
                        message: step.message,
                    })
                );
                timeline += step.duration + 200;
            }

            schedule(timeline + 200, () => {
                send({
                    type: "stage",
                    stageId: "verify",
                    stageState: "error",
                    message: "Replay rejected",
                });
                send({
                    type: "error",
                    message: "IntentNonceMismatch - replay rejected by verifier",
                    errorCode: 6018,
                    level: "error",
                    source: "solana",
                });
                scheduledDone = true;
                send({
                    type: "status",
                    message: isLive ? "pipeline_complete" : "run_failed",
                    source: "solana",
                });
                tryClose();
            });

            if (mode === "live") {
                opsRunning = true;
                const stopOps = startOpsStream(send, true, (result) => {
                    opsRunning = false;
                    send({
                        type: "status",
                        message: result === "ok" ? "run_failed" : "run_failed",
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
                if (parsed.event === "transfer_replay_rejected") {
                    send({
                        type: "error",
                        message: "IntentNonceMismatch - replay rejected",
                        errorCode: 6018,
                        level: "error",
                        source: "solana",
                    });
                }
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
