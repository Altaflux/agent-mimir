import { DeleteSessionResponse } from "@/lib/contracts";
import { jsonError } from "@/server/runtime/http";
import { sessionManager } from "@/server/runtime/session-manager";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
    _request: Request,
    context: {
        params: Promise<{ sessionId: string }>;
    }
) {
    try {
        const { sessionId } = await context.params;
        await sessionManager.deleteSession(sessionId);
        const response: DeleteSessionResponse = { deleted: true };
        return NextResponse.json(response);
    } catch (error) {
        return jsonError(error);
    }
}
