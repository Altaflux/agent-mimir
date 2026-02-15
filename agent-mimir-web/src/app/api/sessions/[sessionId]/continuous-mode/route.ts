import { ToggleContinuousModeRequest, ToggleContinuousModeResponse } from "@/lib/contracts";
import { jsonError, requireBoolean } from "@/server/runtime/http";
import { sessionManager } from "@/server/runtime/session-manager";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    context: {
        params: Promise<{ sessionId: string }>;
    }
) {
    try {
        const { sessionId } = await context.params;
        const payload = (await request.json()) as ToggleContinuousModeRequest;
        const enabled = requireBoolean(payload.enabled, "enabled");

        const session = await sessionManager.setContinuousMode(sessionId, enabled);
        const response: ToggleContinuousModeResponse = { session };
        return NextResponse.json(response);
    } catch (error) {
        return jsonError(error);
    }
}
