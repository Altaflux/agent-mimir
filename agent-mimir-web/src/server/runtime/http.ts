import { HttpError, toHttpError } from "@/server/runtime/errors";
import { NextResponse } from "next/server";

export function jsonError(error: unknown): NextResponse {
    const normalized = toHttpError(error);

    return NextResponse.json(
        {
            error: {
                code: normalized.code,
                message: normalized.message
            }
        },
        { status: normalized.status }
    );
}

export function requireBoolean(value: unknown, fieldName: string): boolean {
    if (typeof value !== "boolean") {
        throw new HttpError(400, "INVALID_REQUEST", `${fieldName} must be a boolean.`);
    }

    return value;
}

export function requireString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new HttpError(400, "INVALID_REQUEST", `${fieldName} must be a non-empty string.`);
    }

    return value;
}
