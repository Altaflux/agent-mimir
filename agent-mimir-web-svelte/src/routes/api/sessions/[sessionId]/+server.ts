import { json } from "@sveltejs/kit";
import type { DeleteSessionResponse } from "@/lib/contracts";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError } from "@/lib/server/http";

export const DELETE = async ({ params }: { params: { sessionId: string } }) => {
    try {
        await sessionManager.deleteSession(params.sessionId);
        const response: DeleteSessionResponse = { deleted: true };
        return json(response);
    } catch (error) {
        return jsonError(error);
    }
};
