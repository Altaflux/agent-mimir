import { json } from "@sveltejs/kit";
import type { ResetSessionResponse } from "@/lib/contracts";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError } from "@/lib/server/http";

export const POST = async ({ params }: { params: { sessionId: string } }) => {
    try {
        const session = await sessionManager.resetSession(params.sessionId);
        const response: ResetSessionResponse = { session };
        return json(response);
    } catch (error) {
        return jsonError(error);
    }
};
