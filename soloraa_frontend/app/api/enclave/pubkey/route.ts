import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const base = process.env.SOLORA_ENCLAVE_URL;
    if (!base) {
        return NextResponse.json(
            { error: "SOLORA_ENCLAVE_URL not set" },
            { status: 500 }
        );
    }

    try {
        const res = await fetch(`${base.replace(/\/$/, "")}/pubkey`, {
            cache: "no-store",
        });
        const json = await res.json();
        return NextResponse.json(json, { status: res.status });
    } catch (err) {
        return NextResponse.json(
            { error: String(err) },
            { status: 500 }
        );
    }
}
