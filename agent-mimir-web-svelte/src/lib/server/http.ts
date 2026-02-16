import { json } from "@sveltejs/kit";
import { requireBoolean, requireString, toHttpError } from "agent-mimir-runtime-shared";

export function jsonError(error: unknown): Response {
    const normalized = toHttpError(error);

    return json(
        {
            error: {
                code: normalized.code,
                message: normalized.message
            }
        },
        { status: normalized.status }
    );
}

export { requireBoolean, requireString };
