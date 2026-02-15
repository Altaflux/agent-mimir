import { ResetSessionResponse } from "@/lib/contracts";
import { jsonError } from "@/server/runtime/http";
import { sessionManager } from "@/server/runtime/session-manager";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
    _request: Request,
    context: {
        params: Promise<{ sessionId: string }>;
    }
) {
    try {
        const { sessionId } = await context.params;
        const session = await sessionManager.resetSession(sessionId);
        const response: ResetSessionResponse = { session };
        return NextResponse.json(response);
    } catch (error) {
        return jsonError(error);
    }
}
