import { SetActiveAgentRequest, SetActiveAgentResponse } from "@/lib/contracts";
import { jsonError, requireString } from "@/server/runtime/http";
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
        const payload = (await request.json()) as SetActiveAgentRequest;
        const agentName = requireString(payload.agentName, "agentName");

        const session = await sessionManager.setActiveAgent(sessionId, agentName);
        const response: SetActiveAgentResponse = { session };
        return NextResponse.json(response);
    } catch (error) {
        return jsonError(error);
    }
}
