import { json } from "@sveltejs/kit";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError } from "@/lib/server/http";

export const GET = async () => {
    try {
        const bootstrap = await sessionManager.getBootstrap();
        return json(bootstrap);
    } catch (error) {
        return jsonError(error);
    }
};
