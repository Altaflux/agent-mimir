export class HttpError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function toHttpError(error: unknown): HttpError {
    if (error instanceof HttpError) {
        return error;
    }

    if (error instanceof Error) {
        return new HttpError(500, "INTERNAL_ERROR", error.message);
    }

    return new HttpError(500, "INTERNAL_ERROR", "Unexpected error");
}
