/* Shared types and API utility functions for the chat interface. */

export type EventMap = Record<string, import("@/lib/contracts").SessionEvent[]>;
export type StateMap = Record<string, import("@/lib/contracts").SessionState>;
export type ErrorPayload = { error?: { code?: string; message?: string } };

export const CHAT_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

export function formatTime(iso: string) {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function apiErrorMessage(errorPayload: unknown, fallback: string): string {
    if (typeof errorPayload === "object" && errorPayload !== null) {
        const maybeError = (errorPayload as { error?: { message?: unknown } }).error;
        if (maybeError && typeof maybeError.message === "string") {
            return maybeError.message;
        }
    }
    return fallback;
}

export function apiErrorCode(errorPayload: unknown): string | undefined {
    if (typeof errorPayload === "object" && errorPayload !== null) {
        const maybeError = (errorPayload as ErrorPayload).error;
        if (maybeError && typeof maybeError.code === "string") {
            return maybeError.code;
        }
    }
    return undefined;
}

export function isChatImageFile(file: File) {
    return CHAT_IMAGE_MIME_TYPES.has(file.type.toLowerCase());
}

export function fileFingerprint(file: File) {
    return `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
}
