import { json } from "@sveltejs/kit";
import type { ToggleContinuousModeRequest, ToggleContinuousModeResponse } from "@/lib/contracts";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError, requireBoolean } from "@/lib/server/http";

export const POST = async ({ params, request }: { params: { sessionId: string }; request: Request }) => {
    try {
        const payload = (await request.json()) as ToggleContinuousModeRequest;
        const enabled = requireBoolean(payload.enabled, "enabled");

        const session = await sessionManager.setContinuousMode(params.sessionId, enabled);
        const response: ToggleContinuousModeResponse = { session };
        return json(response);
    } catch (error) {
        return jsonError(error);
    }
};
