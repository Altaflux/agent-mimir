import { json } from "@sveltejs/kit";
import { HttpError } from "agent-mimir-runtime-shared/runtime/errors";
import type { ApprovalRequest, ApprovalResponse } from "@/lib/contracts";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError } from "@/lib/server/http";

export const POST = async ({ params, request }: { params: { sessionId: string }; request: Request }) => {
    try {
        const payload = (await request.json()) as ApprovalRequest;

        if (payload.action !== "approve" && payload.action !== "disapprove") {
            throw new HttpError(400, "INVALID_REQUEST", "action must be either 'approve' or 'disapprove'.");
        }

        const session = await sessionManager.submitApproval(params.sessionId, payload);
        const response: ApprovalResponse = { session };
        return json(response);
    } catch (error) {
        return jsonError(error);
    }
};
