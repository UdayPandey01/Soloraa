import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const base = process.env.SOLORA_ENCLAVE_URL;
    if (!base) {
        return NextResponse.json(
            { ok: false, error: "SOLORA_ENCLAVE_URL not set" },
            { status: 500 }
        );
    }

    try {
        const res = await fetch(`${base.replace(/\/$/, "")}/health`, {
            cache: "no-store",
        });
        const text = await res.text();
        return NextResponse.json({ ok: res.ok, status: res.status, detail: text });
    } catch (err) {
        return NextResponse.json(
            { ok: false, error: String(err) },
            { status: 500 }
        );
    }
}
