import { json } from "@sveltejs/kit";
import type { SetActiveAgentRequest, SetActiveAgentResponse } from "@/lib/contracts";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError, requireString } from "@/lib/server/http";

export const POST = async ({ params, request }: { params: { sessionId: string }; request: Request }) => {
    try {
        const payload = (await request.json()) as SetActiveAgentRequest;
        const agentName = requireString(payload.agentName, "agentName");

        const session = await sessionManager.setActiveAgent(params.sessionId, agentName);
        const response: SetActiveAgentResponse = { session };
        return json(response);
    } catch (error) {
        return jsonError(error);
    }
};
