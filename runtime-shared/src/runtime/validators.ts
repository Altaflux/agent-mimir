import { HttpError } from "./errors.js";

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
