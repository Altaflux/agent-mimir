import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import crypto from "crypto";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import type {
    ApprovalRequest,
    ApprovalResponse,
    BootstrapResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    DownloadableFile,
    DeleteSessionResponse,
    ListSessionsResponse,
    ResetSessionResponse,
    SendMessageResponse,
    SessionEvent,
    SetActiveAgentRequest,
    SetActiveAgentResponse,
    ToggleContinuousModeRequest,
    ToggleContinuousModeResponse
} from "@mimir/api-contracts/contracts";
import {
    createSessionManager,
    type SendMessageInput,
    type SessionManager,
    type SessionManagerOptions,
    type UploadInput,
    type UploadLimits
} from "@mimir/runtime-shared/runtime/session-manager";
import { HttpError, toHttpError } from "@mimir/runtime-shared/runtime/errors";
import { requireBoolean, requireString } from "@mimir/runtime-shared/runtime/validators";

const HEARTBEAT_MS = 15000;
const DEFAULT_MAX_MULTIPART_FIELDS = 50;
const DEFAULT_API_BODY_LIMIT_BYTES = 30 * 1024 * 1024;

type ApiUploadLimits = UploadLimits & {
    maxMultipartFields: number;
    bodyLimitBytes: number;
};

export type ApiServerOptions = {
    prefix?: string;
    serviceToken?: string;
    enforceServiceToken?: boolean;
    sessionManager?: SessionManager;
    sessionManagerOptions?: SessionManagerOptions;
    uploadLimits?: Partial<ApiUploadLimits>;
};

function normalizePathPrefix(value: string): string {
    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
        return withLeadingSlash.slice(0, -1);
    }

    return withLeadingSlash;
}

function getPublicApiBasePath(): string {
    const configured = process.env.MIMIR_PUBLIC_API_BASE_PATH?.trim() || "/v1";
    return normalizePathPrefix(configured);
}

function inferMimeType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    switch (extension) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".gif":
            return "image/gif";
        case ".pdf":
            return "application/pdf";
        case ".md":
            return "text/markdown";
        case ".txt":
            return "text/plain";
        case ".json":
            return "application/json";
        default:
            return "application/octet-stream";
    }
}

function normalizeError(error: unknown): HttpError {
    if (error instanceof HttpError) {
        return error;
    }

    if (typeof error === "object" && error !== null) {
        const withStatus = error as { statusCode?: unknown; code?: unknown; message?: unknown };
        if (typeof withStatus.statusCode === "number") {
            const code =
                typeof withStatus.code === "string"
                    ? withStatus.code
                    : withStatus.statusCode >= 500
                      ? "INTERNAL_ERROR"
                      : "INVALID_REQUEST";
            const message =
                typeof withStatus.message === "string" && withStatus.message.length > 0
                    ? withStatus.message
                    : "Unexpected error";
            return new HttpError(withStatus.statusCode, code, message);
        }
    }

    return toHttpError(error);
}

function getServiceTokenSettings(options: ApiServerOptions): {
    serviceToken: string;
    enforceServiceToken: boolean;
} {
    const serviceToken = (options.serviceToken ?? process.env.MIMIR_API_SERVICE_TOKEN ?? "").trim();
    const enforceServiceToken = options.enforceServiceToken ?? process.env.NODE_ENV !== "development";

    if (enforceServiceToken && serviceToken.length === 0) {
        throw new Error("MIMIR_API_SERVICE_TOKEN must be set when service-token auth is enforced.");
    }

    return {
        serviceToken,
        enforceServiceToken
    };
}

function encodeSseChunk(payload: SessionEvent): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

function parseOptionalPositiveInt(raw: string | undefined, label: string): number | undefined {
    if (!raw) {
        return undefined;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }

    return parsed;
}

function normalizeOptionalPositiveInt(value: number | undefined, label: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }

    return value;
}

function getApiUploadLimits(options: ApiServerOptions): ApiUploadLimits {
    const optionUploadLimits = options.uploadLimits;

    const maxFilesPerTurn =
        normalizeOptionalPositiveInt(optionUploadLimits?.maxFilesPerTurn, "uploadLimits.maxFilesPerTurn") ??
        parseOptionalPositiveInt(process.env.MIMIR_API_MAX_FILES_PER_TURN, "MIMIR_API_MAX_FILES_PER_TURN") ??
        10;

    const maxFileSizeBytes =
        normalizeOptionalPositiveInt(optionUploadLimits?.maxFileSizeBytes, "uploadLimits.maxFileSizeBytes") ??
        parseOptionalPositiveInt(process.env.MIMIR_API_MAX_FILE_SIZE_BYTES, "MIMIR_API_MAX_FILE_SIZE_BYTES") ??
        25 * 1024 * 1024;

    const maxMultipartFields =
        normalizeOptionalPositiveInt(optionUploadLimits?.maxMultipartFields, "uploadLimits.maxMultipartFields") ??
        parseOptionalPositiveInt(process.env.MIMIR_API_MULTIPART_MAX_FIELDS, "MIMIR_API_MULTIPART_MAX_FIELDS") ??
        DEFAULT_MAX_MULTIPART_FIELDS;

    const bodyLimitBytes =
        normalizeOptionalPositiveInt(optionUploadLimits?.bodyLimitBytes, "uploadLimits.bodyLimitBytes") ??
        parseOptionalPositiveInt(process.env.MIMIR_API_BODY_LIMIT_BYTES, "MIMIR_API_BODY_LIMIT_BYTES") ??
        DEFAULT_API_BODY_LIMIT_BYTES;

    return {
        maxFilesPerTurn,
        maxFileSizeBytes,
        maxMultipartFields,
        bodyLimitBytes
    };
}

function sanitizeStagedUploadName(fileName: string): string {
    const candidate = path.basename(fileName);
    const cleaned = candidate.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
    if (cleaned.length > 0) {
        return cleaned;
    }

    return `upload-${Date.now()}`;
}

function withAttachmentLinks(
    attachments: DownloadableFile[],
    sessionId: string,
    publicApiBasePath: string
): DownloadableFile[] {
    return attachments.map((file) => ({
        ...file,
        href: file.href ?? `${publicApiBasePath}/sessions/${sessionId}/files/${file.fileId}`
    }));
}

function enrichSessionEventForClient(event: SessionEvent, publicApiBasePath: string): SessionEvent {
    if (event.type === "agent_response") {
        return {
            ...event,
            attachments: withAttachmentLinks(event.attachments, event.sessionId, publicApiBasePath)
        };
    }

    if (event.type === "agent_to_agent") {
        return {
            ...event,
            attachments: withAttachmentLinks(event.attachments, event.sessionId, publicApiBasePath)
        };
    }

    return event;
}

export async function createApiServer(options: ApiServerOptions = {}): Promise<FastifyInstance> {
    const prefix = normalizePathPrefix(options.prefix ?? process.env.MIMIR_API_PREFIX ?? "/v1");
    const { serviceToken, enforceServiceToken } = getServiceTokenSettings(options);
    const uploadLimits = getApiUploadLimits(options);
    const publicApiBasePath = getPublicApiBasePath();
    const sessionManager =
        options.sessionManager ??
        createSessionManager({
            ...(options.sessionManagerOptions ?? {}),
            uploadLimits: {
                maxFilesPerTurn: uploadLimits.maxFilesPerTurn,
                maxFileSizeBytes: uploadLimits.maxFileSizeBytes
            }
        });
    const ownsSessionManager = options.sessionManager === undefined;

    const app = Fastify({
        logger: {
            level: process.env.MIMIR_LOG_LEVEL ?? "info"
        },
        bodyLimit: uploadLimits.bodyLimitBytes
    });

    await app.register(multipart, {
        limits: {
            files: uploadLimits.maxFilesPerTurn,
            fileSize: uploadLimits.maxFileSizeBytes,
            fields: uploadLimits.maxMultipartFields
        }
    });

    if (ownsSessionManager) {
        app.addHook("onClose", async () => {
            await sessionManager.shutDown();
        });
    }

    app.setErrorHandler((error, _request, reply) => {
        const normalized = normalizeError(error);
        if (reply.sent) {
            return;
        }

        reply.status(normalized.status).send({
            error: {
                code: normalized.code,
                message: normalized.message
            }
        });
    });

    app.get("/health/live", async () => {
        return { status: "ok" };
    });

    app.get("/health/ready", async () => {
        return { status: "ok" };
    });

    await app.register(
        async (api) => {
            api.addHook("preHandler", async (request) => {
                const shouldValidate = enforceServiceToken || serviceToken.length > 0;
                if (!shouldValidate) {
                    return;
                }

                const providedHeader = request.headers["x-mimir-service-token"];
                const provided = Array.isArray(providedHeader) ? providedHeader[0] : providedHeader;
                if (provided !== serviceToken) {
                    throw new HttpError(401, "UNAUTHORIZED", "Invalid or missing service token.");
                }
            });

            api.get("/bootstrap", async (_request, reply) => {
                const bootstrap = await sessionManager.getBootstrap();
                const response: BootstrapResponse = bootstrap;
                reply.send(response);
            });

            api.get("/sessions", async (_request, reply) => {
                const response: ListSessionsResponse = {
                    sessions: await sessionManager.listSessions()
                };
                reply.header("Cache-Control", "no-store");
                reply.send(response);
            });

            api.post("/sessions", async (request, reply) => {
                const payload = (request.body ?? {}) as CreateSessionRequest;
                const session = await sessionManager.createSession(payload.name);
                const response: CreateSessionResponse = { session };
                reply.status(201).send(response);
            });

            api.delete<{ Params: { sessionId: string } }>("/sessions/:sessionId", async (request, reply) => {
                await sessionManager.deleteSession(request.params.sessionId);
                const response: DeleteSessionResponse = { deleted: true };
                reply.send(response);
            });

            api.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/reset", async (request, reply) => {
                const session = await sessionManager.resetSession(request.params.sessionId);
                const response: ResetSessionResponse = { session };
                reply.send(response);
            });

            api.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/continuous-mode", async (request, reply) => {
                const payload = request.body as ToggleContinuousModeRequest;
                const enabled = requireBoolean(payload.enabled, "enabled");
                const session = await sessionManager.setContinuousMode(request.params.sessionId, enabled);
                const response: ToggleContinuousModeResponse = { session };
                reply.send(response);
            });

            api.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/active-agent", async (request, reply) => {
                const payload = request.body as SetActiveAgentRequest;
                const agentName = requireString(payload.agentName, "agentName");
                const session = await sessionManager.setActiveAgent(request.params.sessionId, agentName);
                const response: SetActiveAgentResponse = { session };
                reply.send(response);
            });

            api.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/approval", async (request, reply) => {
                const payload = request.body as ApprovalRequest;
                if (payload.action !== "approve" && payload.action !== "disapprove") {
                    throw new HttpError(400, "INVALID_REQUEST", "action must be either 'approve' or 'disapprove'.");
                }

                const session = await sessionManager.submitApproval(request.params.sessionId, payload);
                const response: ApprovalResponse = { session };
                reply.send(response);
            });

            api.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/message", async (request, reply) => {
                if (!request.isMultipart()) {
                    throw new HttpError(415, "INVALID_REQUEST", "Content-Type must be multipart/form-data.");
                }

                let text = "";
                const workspaceFiles: UploadInput[] = [];
                const chatImages: UploadInput[] = [];
                const stagedUploadsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mimir-api-upload-"));

                try {
                    for await (const part of request.parts()) {
                        if (part.type === "field") {
                            if (part.fieldname === "message") {
                                text = typeof part.value === "string" ? part.value : String(part.value ?? "");
                            }
                            continue;
                        }

                        const uploadFileName = part.filename || `${part.fieldname}-${Date.now()}`;
                        const stagedFileName = `${crypto.randomUUID()}-${sanitizeStagedUploadName(uploadFileName)}`;
                        const stagedFilePath = path.join(stagedUploadsDirectory, stagedFileName);
                        await pipeline(part.file, createWriteStream(stagedFilePath));

                        if (part.file.truncated) {
                            throw new HttpError(
                                400,
                                "FILE_TOO_LARGE",
                                `File ${uploadFileName} exceeds the ${uploadLimits.maxFileSizeBytes / (1024 * 1024)}MB limit.`
                            );
                        }

                        const upload: UploadInput = {
                            fileName: uploadFileName,
                            contentType: part.mimetype || "application/octet-stream",
                            filePath: stagedFilePath
                        };

                        if (part.fieldname === "workspaceFiles") {
                            workspaceFiles.push(upload);
                            continue;
                        }

                        if (part.fieldname === "chatImages") {
                            chatImages.push(upload);
                        }
                    }

                    if (workspaceFiles.length + chatImages.length > uploadLimits.maxFilesPerTurn) {
                        throw new HttpError(400, "TOO_MANY_FILES", `Maximum ${uploadLimits.maxFilesPerTurn} files per message.`);
                    }

                    const payload: SendMessageInput = {
                        text,
                        workspaceFiles,
                        chatImages
                    };

                    const session = await sessionManager.sendMessage(request.params.sessionId, payload);
                    const response: SendMessageResponse = { session };
                    reply.send(response);
                } finally {
                    await fs.rm(stagedUploadsDirectory, { recursive: true, force: true }).catch(() => {
                        return;
                    });
                }
            });

            api.get<{ Params: { sessionId: string; fileId: string } }>("/sessions/:sessionId/files/:fileId", async (request, reply) => {
                const file = await sessionManager.resolveFile(request.params.sessionId, request.params.fileId);
                const fileStats = await fs.stat(file.absolutePath);
                const stream  = createReadStream(file.absolutePath);
                const safeFileName = file.fileName.replaceAll('"', "");
                return reply
                    .header("Content-Disposition", `attachment; filename=\"${safeFileName}\"`)
                    .header("Content-Length", String(fileStats.size))
                    .type(inferMimeType(file.fileName))
                    .send(stream)
            });

            api.get<{ Params: { sessionId: string } }>("/sessions/:sessionId/stream", async (request, reply) => {
                const { sessionId } = request.params;

                const emitRaw = (chunk: string) => {
                    if (!reply.raw.writableEnded) {
                        reply.raw.write(chunk);
                    }
                };

                const emitEvent = (event: SessionEvent) => {
                    emitRaw(encodeSseChunk(enrichSessionEventForClient(event, publicApiBasePath)));
                };

                const subscription = await sessionManager.subscribe(sessionId, (event) => {
                    emitEvent(event);
                });

                reply.hijack();
                reply.raw.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    Connection: "keep-alive",
                    "Cache-Control": "no-cache, no-transform"
                });

                emitEvent({
                    id: crypto.randomUUID(),
                    sessionId,
                    timestamp: new Date().toISOString(),
                    type: "state_changed",
                    state: subscription.state
                });

                for (const event of subscription.backlog) {
                    emitEvent(event);
                }

                const heartbeat = setInterval(() => {
                    emitRaw(`: heartbeat ${Date.now()}\n\n`);
                }, HEARTBEAT_MS);

                const close = () => {
                    clearInterval(heartbeat);
                    subscription.unsubscribe();
                    if (!reply.raw.writableEnded) {
                        reply.raw.end();
                    }
                };

                request.raw.on("close", close);
                request.raw.on("error", close);
            });
        },
        { prefix }
    );

    return app;
}
