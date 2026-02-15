import { jsonError } from "@/server/runtime/http";
import { sessionManager } from "@/server/runtime/session-manager";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const bootstrap = await sessionManager.getBootstrap();
        return NextResponse.json(bootstrap);
    } catch (error) {
        return jsonError(error);
    }
}
