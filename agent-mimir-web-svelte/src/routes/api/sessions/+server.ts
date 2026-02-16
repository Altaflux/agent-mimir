import { json } from "@sveltejs/kit";
import type { CreateSessionRequest, CreateSessionResponse, ListSessionsResponse } from "@/lib/contracts";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError } from "@/lib/server/http";

export const GET = async () => {
    try {
        const response: ListSessionsResponse = {
            sessions: sessionManager.listSessions()
        };

        return json(response, {
            headers: {
                "Cache-Control": "no-store"
            }
        });
    } catch (error) {
        return jsonError(error);
    }
};

export const POST = async ({ request }: { request: Request }) => {
    try {
        let payload: CreateSessionRequest = {};
        try {
            payload = (await request.json()) as CreateSessionRequest;
        } catch {
            payload = {};
        }

        const session = await sessionManager.createSession(payload.name);
        const response: CreateSessionResponse = { session };
        return json(response, { status: 201 });
    } catch (error) {
        return jsonError(error);
    }
};
