import {
    ApprovalRequest,
    BootstrapResponse,
    DownloadableFile,
    SessionEvent,
    SessionState,
    SessionSummary,
    ToolRequestPayload
} from "@/lib/contracts";
import { getConfig } from "@/server/runtime/config";
import { HttpError } from "@/server/runtime/errors";
import { AgentMimirConfig } from "@/server/runtime/types";
import { FunctionAgentFactory } from "agent-mimir/agent/tool-agent";
import { Agent, InputAgentMessage, SharedFile } from "agent-mimir/agent";
import {
    AgentToolRequestTwo,
    HandleMessageResult,
    IntermediateAgentResponse,
    MultiAgentCommunicationOrchestrator,
    OrchestratorBuilder
} from "agent-mimir/communication/multi-agent";
import { FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import { PluginFactory } from "agent-mimir/plugins";
import { ComplexMessageContent } from "agent-mimir/schema";
import { extractAllTextFromComplexResponse } from "agent-mimir/utils/format";
import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const SESSION_EVENT_CAP = 500;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_FILES_PER_TURN = 10;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

type AgentDefinitionRuntime = {
    mainAgent?: boolean;
    name: string;
    agent: Agent;
};

type SessionListener = (event: SessionEvent) => void;

type SessionFileRecord = {
    fileId: string;
    fileName: string;
    absolutePath: string;
};

type SessionEventPayload = {
    [K in SessionEvent["type"]]: Omit<Extract<SessionEvent, { type: K }>, "id" | "sessionId" | "timestamp">;
}[SessionEvent["type"]];

type UploadInput = {
    fileName: string;
    contentType: string;
    bytes: Buffer;
};

type SendMessageInput = {
    text: string;
    workspaceFiles: UploadInput[];
    chatImages: UploadInput[];
};

type SessionRuntime = {
    sessionId: string;
    name: string;
    createdAt: number;
    lastActivityAt: number;
    continuousMode: boolean;
    activeAgentName: string;
    agentNames: string[];
    agentsByName: Map<string, Agent>;
    orchestrator: MultiAgentCommunicationOrchestrator;
    pendingToolRequest: AgentToolRequestTwo | null;
    eventBuffer: SessionEvent[];
    subscribers: Set<SessionListener>;
    fileRegistry: Map<string, SessionFileRecord>;
    uploadDirectory: string;
    workingRoot: string;
    running: boolean;
};

export type SessionSubscription = {
    state: SessionState;
    backlog: SessionEvent[];
    unsubscribe: () => void;
};

class SessionManager {
    private readonly sessions = new Map<string, SessionRuntime>();

    private constructor() {
        const timer = setInterval(() => {
            this.cleanupExpiredSessions().catch((error) => {
                console.error("Session cleanup failed.", error);
            });
        }, CLEANUP_INTERVAL_MS);

        if (typeof timer.unref === "function") {
            timer.unref();
        }
    }

    static getInstance(): SessionManager {
        const globalStore = globalThis as typeof globalThis & {
            __agentMimirWebSessionManager?: SessionManager;
        };

        if (!globalStore.__agentMimirWebSessionManager) {
            globalStore.__agentMimirWebSessionManager = new SessionManager();
        }

        return globalStore.__agentMimirWebSessionManager;
    }

    async getBootstrap(): Promise<BootstrapResponse> {
        const config = await getConfig();
        const entries = Object.entries(config.agents);
        const main = entries.length === 1 ? entries[0]?.[0] : entries.find(([, definition]) => definition.mainAgent)?.[0] ?? null;
        return {
            availableAgentNames: entries.map(([agentName]) => agentName),
            defaultContinuousMode: config.continuousMode ?? false,
            defaultMainAgent: main
        };
    }

    async createSession(name?: string): Promise<SessionState> {
        const sessionId = crypto.randomUUID();
        const config = await getConfig();
        const now = Date.now();

        const configuredRoot = config.workingDirectory ? path.resolve(config.workingDirectory) : await fs.mkdtemp(path.join(os.tmpdir(), "mimir-web-"));
        const workingRoot = path.join(configuredRoot, sessionId);
        const uploadDirectory = path.join(workingRoot, "_uploads");

        await fs.mkdir(uploadDirectory, { recursive: true });

        const orchestratorBuilder = new OrchestratorBuilder();
        const workspaceFactory = async (agentName: string) => {
            const tempDir = path.join(workingRoot, agentName);
            await fs.mkdir(tempDir, { recursive: true });
            const workspace = new FileSystemAgentWorkspace(tempDir);
            await fs.mkdir(workspace.workingDirectory, { recursive: true });
            return workspace;
        };

        const agents = await this.createAgents(config, orchestratorBuilder, workspaceFactory);

        const mainAgent =
            agents.length === 1
                ? agents[0]?.agent
                : agents.find((agentDefinition) => agentDefinition.mainAgent)?.agent;

        if (!mainAgent) {
            throw new HttpError(500, "INVALID_CONFIG", "No main agent found in configuration.");
        }

        const activeAgentName = mainAgent.name;

        const session: SessionRuntime = {
            sessionId,
            name: name?.trim() || `Chat ${this.sessions.size + 1}`,
            createdAt: now,
            lastActivityAt: now,
            continuousMode: config.continuousMode ?? false,
            activeAgentName,
            agentNames: agents.map((entry) => entry.name),
            agentsByName: new Map(agents.map((entry) => [entry.name, entry.agent])),
            orchestrator: orchestratorBuilder.build(mainAgent),
            pendingToolRequest: null,
            eventBuffer: [],
            subscribers: new Set<SessionListener>(),
            fileRegistry: new Map(),
            uploadDirectory,
            workingRoot,
            running: false
        };

        this.sessions.set(sessionId, session);
        this.emitStateChanged(session);
        return this.toSessionState(session);
    }

    listSessions(): SessionSummary[] {
        return [...this.sessions.values()]
            .map((session) => this.toSessionSummary(session))
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }

    getSessionState(sessionId: string): SessionState {
        const session = this.requireSession(sessionId);
        return this.toSessionState(session);
    }

    async deleteSession(sessionId: string): Promise<void> {
        const session = this.requireSession(sessionId);
        if (session.running) {
            throw new HttpError(409, "SESSION_BUSY", "Cannot delete a session while it is processing a request.");
        }

        await this.disposeSession(session);
    }

    async resetSession(sessionId: string): Promise<SessionState> {
        const session = this.requireSession(sessionId);
        return await this.withSessionLock(session, async () => {
            await session.orchestrator.reset({ threadId: session.sessionId });
            session.pendingToolRequest = null;
            session.fileRegistry.clear();

            this.emitEvent(session, {
                type: "reset",
                message: "Session reset."
            });

            this.emitStateChanged(session);
            return this.toSessionState(session);
        });
    }

    async setContinuousMode(sessionId: string, enabled: boolean): Promise<SessionState> {
        const session = this.requireSession(sessionId);
        if (session.running) {
            throw new HttpError(409, "SESSION_BUSY", "Cannot change continuous mode while the session is processing.");
        }

        session.continuousMode = enabled;
        session.lastActivityAt = Date.now();
        this.emitStateChanged(session);
        return this.toSessionState(session);
    }

    async setActiveAgent(sessionId: string, activeAgentName: string): Promise<SessionState> {
        const session = this.requireSession(sessionId);
        if (session.running) {
            throw new HttpError(409, "SESSION_BUSY", "Cannot switch active agent while the session is processing.");
        }

        const selectedAgent = session.agentsByName.get(activeAgentName);
        if (!selectedAgent) {
            throw new HttpError(404, "AGENT_NOT_FOUND", `Agent \"${activeAgentName}\" is not registered for this session.`);
        }

        session.orchestrator.currentAgent = selectedAgent;
        session.activeAgentName = activeAgentName;
        session.lastActivityAt = Date.now();
        this.emitStateChanged(session);
        return this.toSessionState(session);
    }

    async sendMessage(sessionId: string, input: SendMessageInput): Promise<SessionState> {
        const session = this.requireSession(sessionId);
        return await this.withSessionLock(session, async () => {
            if (session.pendingToolRequest) {
                throw new HttpError(409, "PENDING_APPROVAL", "A tool approval decision is required before sending a new message.");
            }

            this.validateUploadInput(input);
            const { agentInput, workspaceFileNames, chatImageNames } = await this.buildInputMessage(session, input);

            if ((agentInput.content.length === 0 || extractAllTextFromComplexResponse(agentInput.content).trim().length === 0) &&
                (agentInput.sharedFiles?.length ?? 0) === 0) {
                throw new HttpError(400, "EMPTY_MESSAGE", "Message text or attachments are required.");
            }

            this.emitEvent(session, {
                type: "user_message",
                text: input.text,
                workspaceFiles: workspaceFileNames,
                chatImages: chatImageNames
            });

            let generator = session.orchestrator.handleMessage({ message: agentInput }, session.sessionId);
            await this.consumeGenerator(session, generator);
            this.emitStateChanged(session);
            return this.toSessionState(session);
        });
    }

    async submitApproval(sessionId: string, request: ApprovalRequest): Promise<SessionState> {
        const session = this.requireSession(sessionId);
        return await this.withSessionLock(session, async () => {
            const pending = session.pendingToolRequest;
            if (!pending) {
                throw new HttpError(409, "NO_PENDING_TOOL_REQUEST", "There is no pending tool request to approve or reject.");
            }

            session.pendingToolRequest = null;

            if (request.action === "disapprove") {
                const feedback = request.feedback?.trim();
                if (!feedback) {
                    throw new HttpError(400, "MISSING_FEEDBACK", "Disapproval requires a feedback message.");
                }

                this.emitEvent(session, {
                    type: "user_message",
                    text: feedback,
                    workspaceFiles: [],
                    chatImages: []
                });

                const generator = session.orchestrator.handleMessage(
                    {
                        message: {
                            content: [{ type: "text", text: feedback }],
                            sharedFiles: []
                        }
                    },
                    session.sessionId
                );
                await this.consumeGenerator(session, generator);
            } else {
                const generator = session.orchestrator.handleMessage({ message: null }, session.sessionId);
                await this.consumeGenerator(session, generator);
            }

            this.emitStateChanged(session);
            return this.toSessionState(session);
        });
    }

    subscribe(sessionId: string, listener: SessionListener): SessionSubscription {
        const session = this.requireSession(sessionId);
        session.subscribers.add(listener);
        session.lastActivityAt = Date.now();

        return {
            state: this.toSessionState(session),
            backlog: [...session.eventBuffer],
            unsubscribe: () => {
                session.subscribers.delete(listener);
            }
        };
    }

    async resolveFile(sessionId: string, fileId: string): Promise<SessionFileRecord> {
        const session = this.requireSession(sessionId);
        const found = session.fileRegistry.get(fileId);
        if (!found) {
            throw new HttpError(404, "FILE_NOT_FOUND", "File not found for this session.");
        }

        const exists = await fs
            .access(found.absolutePath, fs.constants.F_OK)
            .then(() => true)
            .catch(() => false);

        if (!exists) {
            throw new HttpError(404, "FILE_NOT_FOUND", "File no longer exists on disk.");
        }

        return found;
    }

    private async createAgents(
        config: AgentMimirConfig,
        builder: OrchestratorBuilder,
        workspaceFactory: (agentName: string) => Promise<FileSystemAgentWorkspace>
    ): Promise<AgentDefinitionRuntime[]> {
        return await Promise.all(
            Object.entries(config.agents).map(async ([agentName, agentDefinition]) => {
                if (!agentDefinition.definition) {
                    throw new HttpError(500, "INVALID_CONFIG", `Agent \"${agentName}\" has no definition.`);
                }

                const definition = agentDefinition.definition;
                const factory = new FunctionAgentFactory({
                    description: agentDefinition.description,
                    profession: definition.profession,
                    model: definition.chatModel,
                    checkpointer: definition.checkpointer,
                    visionSupport: definition.visionSupport,
                    constitution: definition.constitution,
                    plugins: [...(definition.plugins ?? []) as PluginFactory[]],
                    workspaceFactory
                });

                const initialized = await builder.initializeAgent(factory, agentName, definition.communicationWhitelist);

                return {
                    mainAgent: agentDefinition.mainAgent,
                    name: agentName,
                    agent: initialized
                } satisfies AgentDefinitionRuntime;
            })
        );
    }

    private validateUploadInput(input: SendMessageInput) {
        const fileCount = input.workspaceFiles.length + input.chatImages.length;
        if (fileCount > MAX_FILES_PER_TURN) {
            throw new HttpError(400, "TOO_MANY_FILES", `A maximum of ${MAX_FILES_PER_TURN} files are allowed per message.`);
        }

        const allFiles = [...input.workspaceFiles, ...input.chatImages];
        for (const file of allFiles) {
            if (file.bytes.byteLength > MAX_FILE_SIZE_BYTES) {
                throw new HttpError(400, "FILE_TOO_LARGE", `File ${file.fileName} exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`);
            }
        }

        for (const image of input.chatImages) {
            if (!this.isImageMimeType(image.contentType)) {
                throw new HttpError(422, "UNSUPPORTED_CHAT_IMAGE", `Unsupported chat image type: ${image.contentType || "unknown"}.`);
            }
        }
    }

    private async buildInputMessage(
        session: SessionRuntime,
        input: SendMessageInput
    ): Promise<{
        agentInput: InputAgentMessage;
        workspaceFileNames: string[];
        chatImageNames: string[];
    }> {
        const sharedFiles: SharedFile[] = [];
        const usedNames = new Set<string>();
        const workspaceFileNames: string[] = [];
        const chatImageNames: string[] = [];

        const writeUpload = async (upload: UploadInput, fallbackPrefix: string): Promise<SharedFile> => {
            const safeFileName = this.makeUniqueFileName(usedNames, this.sanitizeFileName(upload.fileName, fallbackPrefix));
            const storedPath = path.join(session.uploadDirectory, `${crypto.randomUUID()}-${safeFileName}`);
            await fs.mkdir(session.uploadDirectory, { recursive: true });
            await fs.writeFile(storedPath, upload.bytes);

            return {
                fileName: safeFileName,
                url: storedPath
            };
        };

        for (const file of input.workspaceFiles) {
            const shared = await writeUpload(file, "workspace");
            sharedFiles.push(shared);
            workspaceFileNames.push(shared.fileName);
        }

        const chatImageContent: ComplexMessageContent[] = [];
        for (const image of input.chatImages) {
            const shared = await writeUpload(image, "image");
            sharedFiles.push(shared);
            chatImageNames.push(shared.fileName);

            const mimeType = image.contentType.toLowerCase();
            const imageType = mimeType.includes("png") ? "png" : "jpeg";
            chatImageContent.push({
                type: "image_url",
                image_url: {
                    type: imageType,
                    url: image.bytes.toString("base64")
                }
            });
        }

        const textContent = input.text.trim();
        const content: ComplexMessageContent[] = [];
        if (textContent.length > 0) {
            content.push({ type: "text", text: textContent });
        }
        content.push(...chatImageContent);

        return {
            agentInput: {
                content,
                sharedFiles
            },
            workspaceFileNames,
            chatImageNames
        };
    }

    private async consumeGenerator(
        session: SessionRuntime,
        generator: AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void>
    ) {
        let result: IteratorResult<IntermediateAgentResponse, HandleMessageResult>;

        while (true) {
            while (!(result = await generator.next()).done) {
                await this.handleIntermediateResponse(session, result.value);
            }

            if (result.value.type === "agentResponse") {
                const text = extractAllTextFromComplexResponse(result.value.content.content);
                const attachments = await this.registerSharedFiles(session, result.value.content.sharedFiles ?? []);
                this.emitEvent(session, {
                    type: "agent_response",
                    agentName: session.orchestrator.currentAgent.name,
                    markdown: text,
                    attachments
                });
                return;
            }

            const pending = result.value;
            const pendingPayload = this.toToolRequestPayload(pending);
            this.emitEvent(session, {
                type: "tool_request",
                payload: pendingPayload
            });

            if (!session.continuousMode) {
                session.pendingToolRequest = pending;
                return;
            }

            generator = session.orchestrator.handleMessage({ message: null }, session.sessionId);
        }
    }

    private async handleIntermediateResponse(session: SessionRuntime, chainResponse: IntermediateAgentResponse) {
        if (chainResponse.type === "intermediateOutput" && chainResponse.value.type === "toolResponse") {
            this.emitEvent(session, {
                type: "tool_response",
                agentName: chainResponse.agentName,
                toolName: chainResponse.value.toolResponse.name,
                toolCallId: chainResponse.value.toolResponse.id,
                response: extractAllTextFromComplexResponse(chainResponse.value.toolResponse.response)
            });
            return;
        }

        if (chainResponse.type === "agentToAgentMessage") {
            const attachments = await this.registerSharedFiles(session, chainResponse.value.content.sharedFiles ?? []);
            this.emitEvent(session, {
                type: "agent_to_agent",
                sourceAgent: chainResponse.value.sourceAgent,
                destinationAgent: chainResponse.value.destinationAgent,
                message: extractAllTextFromComplexResponse(chainResponse.value.content.content),
                attachments
            });
        }
    }

    private async registerSharedFiles(session: SessionRuntime, sharedFiles: SharedFile[]): Promise<DownloadableFile[]> {
        const results: DownloadableFile[] = [];

        for (const file of sharedFiles) {
            const fileId = crypto.randomUUID();
            session.fileRegistry.set(fileId, {
                fileId,
                fileName: file.fileName,
                absolutePath: file.url
            });

            results.push({
                fileId,
                fileName: file.fileName,
                href: `/api/sessions/${session.sessionId}/files/${fileId}`
            });
        }

        return results;
    }

    private toToolRequestPayload(toolRequest: AgentToolRequestTwo): ToolRequestPayload {
        return {
            callingAgent: toolRequest.callingAgent,
            content: extractAllTextFromComplexResponse(toolRequest.content),
            toolCalls: (toolRequest.toolCalls ?? []).map((toolCall) => ({
                id: toolCall.id,
                toolName: toolCall.toolName,
                input: toolCall.input
            }))
        };
    }

    private emitStateChanged(session: SessionRuntime) {
        this.emitEvent(session, {
            type: "state_changed",
            state: this.toSessionState(session)
        });
    }

    private emitEvent(session: SessionRuntime, event: SessionEventPayload) {
        const enriched = {
            ...event,
            id: crypto.randomUUID(),
            sessionId: session.sessionId,
            timestamp: new Date().toISOString()
        } as unknown as SessionEvent;

        session.lastActivityAt = Date.now();
        session.eventBuffer.push(enriched);
        if (session.eventBuffer.length > SESSION_EVENT_CAP) {
            session.eventBuffer.shift();
        }

        for (const listener of session.subscribers) {
            listener(enriched);
        }
    }

    private async withSessionLock<T>(session: SessionRuntime, operation: () => Promise<T>): Promise<T> {
        if (session.running) {
            throw new HttpError(409, "SESSION_BUSY", "Session is already processing another request.");
        }

        session.running = true;
        session.lastActivityAt = Date.now();

        try {
            return await operation();
        } catch (error) {
            const normalized = error instanceof HttpError ? error : new HttpError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unexpected error");
            this.emitEvent(session, {
                type: "error",
                message: normalized.message,
                code: normalized.code
            });
            throw normalized;
        } finally {
            session.running = false;
            session.lastActivityAt = Date.now();
        }
    }

    private requireSession(sessionId: string): SessionRuntime {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new HttpError(404, "SESSION_NOT_FOUND", `Session \"${sessionId}\" was not found.`);
        }

        return session;
    }

    private toSessionSummary(session: SessionRuntime): SessionSummary {
        return {
            sessionId: session.sessionId,
            name: session.name,
            createdAt: new Date(session.createdAt).toISOString(),
            lastActivityAt: new Date(session.lastActivityAt).toISOString(),
            activeAgentName: session.activeAgentName,
            continuousMode: session.continuousMode,
            hasPendingToolRequest: session.pendingToolRequest !== null
        };
    }

    private toSessionState(session: SessionRuntime): SessionState {
        return {
            ...this.toSessionSummary(session),
            agentNames: [...session.agentNames],
            pendingToolRequest: session.pendingToolRequest ? this.toToolRequestPayload(session.pendingToolRequest) : undefined
        };
    }

    private isImageMimeType(mimeType: string): boolean {
        const normalized = mimeType.toLowerCase();
        return normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/jpg";
    }

    private sanitizeFileName(fileName: string, prefix: string): string {
        const candidate = path.basename(fileName || `${prefix}-${Date.now()}`);
        const cleaned = candidate.replace(/[^a-zA-Z0-9._-]/g, "_");
        const shortened = cleaned.slice(0, 180);
        if (!shortened) {
            return `${prefix}-${Date.now()}`;
        }

        return shortened;
    }

    private makeUniqueFileName(registry: Set<string>, fileName: string): string {
        if (!registry.has(fileName)) {
            registry.add(fileName);
            return fileName;
        }

        const extension = path.extname(fileName);
        const stem = fileName.slice(0, fileName.length - extension.length);

        let counter = 1;
        while (true) {
            const candidate = `${stem}-${counter}${extension}`;
            if (!registry.has(candidate)) {
                registry.add(candidate);
                return candidate;
            }
            counter += 1;
        }
    }

    private async cleanupExpiredSessions() {
        const now = Date.now();
        const expired = [...this.sessions.values()].filter((session) => !session.running && now - session.lastActivityAt > SESSION_TTL_MS);

        for (const session of expired) {
            await this.disposeSession(session);
        }
    }

    private async disposeSession(session: SessionRuntime): Promise<void> {
        this.sessions.delete(session.sessionId);
        session.subscribers.clear();

        await fs.rm(session.workingRoot, { recursive: true, force: true }).catch(() => {
            return;
        });
    }
}

export const sessionManager = SessionManager.getInstance();
export type { UploadInput, SendMessageInput };
