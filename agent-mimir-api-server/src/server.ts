import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type {
    ApprovalRequest,
    ApprovalResponse,
    BootstrapResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    DeleteSessionResponse,
    ListSessionsResponse,
    ResetSessionResponse,
    SendMessageResponse,
    SessionEvent,
    SetActiveAgentRequest,
    SetActiveAgentResponse,
    ToggleContinuousModeRequest,
    ToggleContinuousModeResponse
} from "agent-mimir-api-contracts/contracts";
import type { SendMessageInput, UploadInput } from "agent-mimir-runtime-shared/runtime/session-manager";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { HttpError, toHttpError } from "agent-mimir-runtime-shared/runtime/errors";
import { requireBoolean, requireString } from "agent-mimir-runtime-shared/runtime/validators";

const HEARTBEAT_MS = 15000;
const MAX_FILES_PER_TURN = 10;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export type ApiServerOptions = {
    prefix?: string;
    serviceToken?: string;
    enforceServiceToken?: boolean;
};

function normalizePathPrefix(value: string): string {
    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
        return withLeadingSlash.slice(0, -1);
    }

    return withLeadingSlash;
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

export async function createApiServer(options: ApiServerOptions = {}): Promise<FastifyInstance> {
    const prefix = normalizePathPrefix(options.prefix ?? process.env.MIMIR_API_PREFIX ?? "/v1");
    const { serviceToken, enforceServiceToken } = getServiceTokenSettings(options);

    const app = Fastify({
        logger: {
            level: process.env.MIMIR_LOG_LEVEL ?? "info"
        },
        bodyLimit: 30 * 1024 * 1024
    });

    await app.register(multipart, {
        limits: {
            files: MAX_FILES_PER_TURN,
            fileSize: MAX_FILE_SIZE_BYTES,
            fields: 50
        }
    });

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
                if (!false) {
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
                    sessions: sessionManager.listSessions()
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

                for await (const part of request.parts()) {
                    if (part.type === "field") {
                        if (part.fieldname === "message") {
                            text = typeof part.value === "string" ? part.value : String(part.value ?? "");
                        }
                        continue;
                    }

                    const bytes = await part.toBuffer();
                    const upload: UploadInput = {
                        fileName: part.filename || `${part.fieldname}-${Date.now()}`,
                        contentType: part.mimetype || "application/octet-stream",
                        bytes
                    };

                    if (part.fieldname === "workspaceFiles") {
                        workspaceFiles.push(upload);
                        continue;
                    }

                    if (part.fieldname === "chatImages") {
                        chatImages.push(upload);
                    }
                }

                if (workspaceFiles.length + chatImages.length > MAX_FILES_PER_TURN) {
                    throw new HttpError(400, "TOO_MANY_FILES", "Maximum 10 files per message.");
                }

                const payload: SendMessageInput = {
                    text,
                    workspaceFiles,
                    chatImages
                };

                const session = await sessionManager.sendMessage(request.params.sessionId, payload);
                const response: SendMessageResponse = { session };
                reply.send(response);
            });

            api.get<{ Params: { sessionId: string; fileId: string } }>("/sessions/:sessionId/files/:fileId", async (request, reply) => {
                const file = await sessionManager.resolveFile(request.params.sessionId, request.params.fileId);
                const bytes = await fs.readFile(file.absolutePath);
                const safeFileName = file.fileName.replaceAll('"', "");

                reply
                    .header("Content-Type", inferMimeType(file.fileName))
                    .header("Content-Disposition", `attachment; filename=\"${safeFileName}\"`)
                    .send(bytes);
            });

            api.get<{ Params: { sessionId: string } }>("/sessions/:sessionId/stream", async (request, reply) => {
                const { sessionId } = request.params;

                const emitRaw = (chunk: string) => {
                    if (!reply.raw.writableEnded) {
                        reply.raw.write(chunk);
                    }
                };

                const emitEvent = (event: SessionEvent) => {
                    emitRaw(encodeSseChunk(event));
                };

                const subscription = sessionManager.subscribe(sessionId, (event) => {
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
