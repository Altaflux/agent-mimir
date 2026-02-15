import { ApprovalRequest, ApprovalResponse } from "@/lib/contracts";
import { HttpError } from "@/server/runtime/errors";
import { jsonError } from "@/server/runtime/http";
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
        const payload = (await request.json()) as ApprovalRequest;

        if (payload.action !== "approve" && payload.action !== "disapprove") {
            throw new HttpError(400, "INVALID_REQUEST", "action must be either 'approve' or 'disapprove'.");
        }

        const session = await sessionManager.submitApproval(sessionId, payload);
        const response: ApprovalResponse = { session };
        return NextResponse.json(response);
    } catch (error) {
        return jsonError(error);
    }
}
