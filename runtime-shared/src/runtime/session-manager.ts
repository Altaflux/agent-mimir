import {
  ApprovalRequest,
  BootstrapResponse,
  DownloadableFile,
  PluginElicitationResponseRequest,
  PluginStateDetail,
  PluginStateSummary,
  SessionEvent,
  SessionState,
  SessionSummary,
  ToolRequestPayload,
  UserMessageOrigin,
} from "../contracts.js";
import { getConfig } from "./config.js";
import { HttpError } from "./errors.js";
import type { AgentMimirConfig } from "./types.js";
import {
  Agent,
  AgentInput,
  AgentNotificationInput,
  InputAgentMessage,
  SharedFile,
} from "@mimir/agent-core/agent";
import {
  AgentHydrationEventWithAgent,
  AgentToolRequestTwo,
  HandleMessageResult,
  HydratedOrchestratorEvent,
  IntermediateAgentResponse,
  MultiAgentCommunicationOrchestrator,
  OrchestratorBuilder,
} from "@mimir/agent-core/communication/multi-agent";
import { FileSystemAgentWorkspace } from "@mimir/agent-core/nodejs";
import {
  PluginNotification,
  PluginRuntimeProvider,
} from "@mimir/agent-core/plugins";
import { ComplexMessageContent } from "@mimir/agent-core/schema";
import { extractAllTextFromComplexResponse } from "@mimir/agent-core/utils/format";
import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  SessionStore,
  type StoredPluginRuntimeEvent,
  type StoredSessionRecord,
} from "./session-store.js";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import Database from "better-sqlite3";
import { readHydrationEvents } from "@mimir/agent-core/utils/hydration";
import { FunctionAgentFactory } from "@mimir/agent-core/agent/tool-agent";
import { SessionPluginRuntimeController } from "./plugin-runtime.js";
import { DiskPluginStateStore } from "./plugin-state-store.js";

const SESSION_EVENT_CAP = 500;
const DEFAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_FILES_PER_TURN = 10;
const DEFAULT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

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
  [K in SessionEvent["type"]]: Omit<
    Extract<SessionEvent, { type: K }>,
    "id" | "sessionId" | "timestamp"
  >;
}[SessionEvent["type"]];

type PluginRuntimeSessionEventType =
  | "plugin_event"
  | "plugin_notification"
  | "plugin_state"
  | "plugin_log"
  | "plugin_elicitation_request"
  | "plugin_elicitation_response"
  | "plugin_elicitation_complete";

type PluginRuntimeSessionEventPayload = {
  [K in PluginRuntimeSessionEventType]: Omit<
    Extract<SessionEvent, { type: K }>,
    "id" | "sessionId" | "timestamp"
  >;
}[PluginRuntimeSessionEventType];

type UploadInputBase = {
  fileName: string;
  contentType: string;
};

type UploadInput =
  | (UploadInputBase & {
      bytes: Buffer;
      filePath?: never;
    })
  | (UploadInputBase & {
      filePath: string;
      bytes?: never;
    });

type SendMessageInput = {
  text: string;
  workspaceFiles: UploadInput[];
  chatImages: UploadInput[];
};

type UploadLimits = {
  maxFilesPerTurn: number;
  maxFileSizeBytes: number;
};

type SessionManagerOptions = {
  sessionTtlMs?: number;
  cleanupIntervalMs?: number;
  uploadLimits?: Partial<UploadLimits>;
};

type SessionRuntime = {
  sessionId: string;
  name: string;
  createdAt: number;
  lastActivityAt: number;
  continuousMode: boolean;
  agentName: string;
  checkpointer: SqliteSaver;
  orchestrator: MultiAgentCommunicationOrchestrator;
  pluginRuntime: SessionPluginRuntimeController;
  pendingToolRequest: AgentToolRequestTwo | null;
  eventBuffer: SessionEvent[];
  subscribers: Set<SessionListener>;
  fileRegistry: Map<string, SessionFileRecord>;
  uploadDirectory: string;
  workingRoot: string;
  cleanupPath: string;
  running: boolean;
  abortController?: AbortController;
};

type RuntimeConfigBundle = {
  config: AgentMimirConfig;
  configuredRoot: string;
  sessionsRoot: string;
};

type EmitEventOptions = {
  timestamp?: string;
  preserveLastActivity?: boolean;
};

type PluginStateAssetFileRecord = {
  absolutePath: string;
  fileName: string;
  contentType: string;
};

export type SessionSubscription = {
  state: SessionState;
  backlog: SessionEvent[];
  unsubscribe: () => void;
};

function requirePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return value;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly sessionHydrationPromises = new Map<
    string,
    Promise<SessionRuntime>
  >();
  private readonly sessionTtlMs: number;
  private readonly uploadLimits: UploadLimits;
  private readonly cleanupTimer: NodeJS.Timeout;
  private runtimeConfigPromise: Promise<RuntimeConfigBundle> | null = null;
  private store: SessionStore | null = null;

  constructor(options: SessionManagerOptions = {}) {
    this.sessionTtlMs =
      options.sessionTtlMs === undefined
        ? DEFAULT_SESSION_TTL_MS
        : requirePositiveInteger(options.sessionTtlMs, "sessionTtlMs");

    const maxFilesPerTurn =
      options.uploadLimits?.maxFilesPerTurn === undefined
        ? DEFAULT_MAX_FILES_PER_TURN
        : requirePositiveInteger(
            options.uploadLimits.maxFilesPerTurn,
            "uploadLimits.maxFilesPerTurn",
          );

    const maxFileSizeBytes =
      options.uploadLimits?.maxFileSizeBytes === undefined
        ? DEFAULT_MAX_FILE_SIZE_BYTES
        : requirePositiveInteger(
            options.uploadLimits.maxFileSizeBytes,
            "uploadLimits.maxFileSizeBytes",
          );

    this.uploadLimits = {
      maxFilesPerTurn,
      maxFileSizeBytes,
    };

    const cleanupIntervalMs =
      options.cleanupIntervalMs === undefined
        ? DEFAULT_CLEANUP_INTERVAL_MS
        : requirePositiveInteger(
            options.cleanupIntervalMs,
            "cleanupIntervalMs",
          );

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions().catch((error) => {
        console.error("Session cleanup failed.", error);
      });
    }, cleanupIntervalMs);

    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  async getBootstrap(): Promise<BootstrapResponse> {
    const config = await getConfig();
    const entries = Object.entries(config.agents);
    const defaultAgentName =
      entries.length === 1
        ? entries[0]?.[0]
        : (entries.find(([, definition]) => definition.mainAgent)?.[0] ?? null);
    return {
      availableAgentNames: entries.map(([agentName]) => agentName),
      defaultContinuousMode: config.continuousMode ?? false,
      defaultAgentName,
    };
  }

  private async getRuntimeConfig(): Promise<RuntimeConfigBundle> {
    if (!this.runtimeConfigPromise) {
      this.runtimeConfigPromise = (async () => {
        const config = await getConfig();
        const configuredRoot = config.workingDirectory
          ? path.resolve(config.workingDirectory)
          : path.join(os.tmpdir(), "mimir-web-db-fallback");
        const sessionsRoot = path.join(configuredRoot, "sessions");
        await fs.mkdir(sessionsRoot, { recursive: true });
        const store = new SessionStore();
        await store.init(configuredRoot);
        this.store = store;
        return {
          config,
          configuredRoot,
          sessionsRoot,
        };
      })();
    }

    return await this.runtimeConfigPromise;
  }

  private async ensureSessionLoaded(
    sessionId: string,
  ): Promise<SessionRuntime> {
    const existingSession = this.sessions.get(sessionId);
    if (existingSession) {
      return existingSession;
    }

    const { config, sessionsRoot } = await this.getRuntimeConfig();
    const storedSession = this.store?.getSession(sessionId);
    if (!storedSession) {
      throw new HttpError(
        404,
        "SESSION_NOT_FOUND",
        `Session \"${sessionId}\" was not found.`,
      );
    }

    const existingHydration = this.sessionHydrationPromises.get(sessionId);
    if (existingHydration) {
      return await existingHydration;
    }

    const hydrationPromise = (async () => {
      await this.hydrateSessionRuntime(storedSession, config, sessionsRoot);
      return this.requireSession(sessionId);
    })();

    this.sessionHydrationPromises.set(sessionId, hydrationPromise);
    try {
      return await hydrationPromise;
    } finally {
      this.sessionHydrationPromises.delete(sessionId);
    }
  }

  private getDefaultAgentName(config: AgentMimirConfig): string | null {
    const entries = Object.entries(config.agents);
    if (entries.length === 0) {
      return null;
    }
    if (entries.length === 1) {
      return entries[0]![0];
    }

    return (
      entries.find(([, definition]) => definition.mainAgent)?.[0] ??
      entries[0]![0]
    );
  }

  private buildStoredSessionSummary(
    record: StoredSessionRecord,
  ): SessionSummary {
    return {
      sessionId: record.sessionId,
      name: record.name,
      createdAt: new Date(record.createdAtMs).toISOString(),
      lastActivityAt: new Date(record.lastActivityAtMs).toISOString(),
      agentName: record.agentName,
      continuousMode: record.continuousMode,
      hasPendingToolRequest: false,
    };
  }

  private getSessionPaths(sessionsRoot: string, sessionId: string) {
    const workingRoot = path.join(sessionsRoot, sessionId);
    return {
      workingRoot,
      cleanupPath: workingRoot,
      uploadDirectory: path.join(workingRoot, "_uploads"),
      pluginStateDirectory: path.join(workingRoot, "_plugin_state"),
      checkpointerPath: path.join(workingRoot, "chat-checkpointer.db"),
    };
  }

  private createSessionCheckpointer(checkpointerPath: string): SqliteSaver {
    return new SqliteSaver(new Database(checkpointerPath));
  }

  private async hydrateSessionRuntime(
    persistedSession: StoredSessionRecord,
    config: AgentMimirConfig,
    sessionsRoot: string,
  ): Promise<void> {
    if (this.sessions.has(persistedSession.sessionId)) {
      return;
    }

    const paths = this.getSessionPaths(
      sessionsRoot,
      persistedSession.sessionId,
    );
    await fs.mkdir(paths.uploadDirectory, { recursive: true });
    const checkpointer = this.createSessionCheckpointer(paths.checkpointerPath);

    const orchestratorBuilder = new OrchestratorBuilder(
      persistedSession.sessionId,
    );
    const workspaceFactory = async () => {
      await fs.mkdir(paths.workingRoot, { recursive: true });
      const workspace = new FileSystemAgentWorkspace(paths.workingRoot);
      await fs.mkdir(workspace.workingDirectory, { recursive: true });
      return workspace;
    };

    const principalAgentName = persistedSession.agentName;
    const storedNotifications =
      this.store?.listPluginNotifications(persistedSession.sessionId) ?? [];
    const pluginRuntime = new SessionPluginRuntimeController(
      principalAgentName,
      storedNotifications.map(
        (storedNotification) => storedNotification.notification,
      ),
    );
    const pluginStateStore = new DiskPluginStateStore(
      paths.pluginStateDirectory,
    );
    await pluginStateStore.clear();
    this.configurePluginRuntimeStorage(
      persistedSession.sessionId,
      pluginRuntime,
      pluginStateStore,
    );
    const principal = await this.createAgent(
      config,
      checkpointer,
      orchestratorBuilder,
      workspaceFactory,
      principalAgentName,
      pluginRuntime,
    );

    const session: SessionRuntime = {
      sessionId: persistedSession.sessionId,
      name: persistedSession.name,
      createdAt: persistedSession.createdAtMs,
      lastActivityAt: persistedSession.lastActivityAtMs,
      continuousMode: persistedSession.continuousMode,
      agentName: principal.agent.name,
      checkpointer,
      orchestrator: orchestratorBuilder.build(principal.agent),
      pluginRuntime,
      pendingToolRequest: null,
      eventBuffer: [],
      subscribers: new Set<SessionListener>(),
      fileRegistry: new Map(),
      uploadDirectory: paths.uploadDirectory,
      workingRoot: paths.workingRoot,
      cleanupPath: paths.cleanupPath,
      running: false,
      abortController: undefined,
    };

    const hydrationEvents: AgentHydrationEventWithAgent[] = [];
    let sequence = 0;

    const events = await readHydrationEvents({
      sessionId: persistedSession.sessionId,
      checkpointer,
    });
    for (const event of events) {
      hydrationEvents.push({
        ...event,
        agentName: principal.name,
        sequence: sequence++,
      });
    }

    const replayedConversation =
      await session.orchestrator.hydrateConversation(hydrationEvents);
    await this.applyHydratedConversation(session, replayedConversation);
    this.restorePersistedPluginRuntimeEvents(session);
    this.sessions.set(session.sessionId, session);
    this.attachPluginRuntime(session);
    this.persistSessionMetadata(session);
  }

  private async applyHydratedConversation(
    session: SessionRuntime,
    events: HydratedOrchestratorEvent[],
  ) {
    let latestActivity = session.lastActivityAt;
    for (const event of events) {
      const parsedTimestamp = Date.parse(event.timestamp);
      if (Number.isFinite(parsedTimestamp)) {
        latestActivity = Math.max(latestActivity, parsedTimestamp);
      }

      if (event.type === "userMessage") {
        const presentation = this.getHydratedInputPresentation(event.input);
        this.emitEvent(
          session,
          {
            type: "user_message",
            origin: presentation.origin,
            text: presentation.text,
            workspaceFiles: presentation.workspaceFiles,
            chatImages: presentation.chatImages,
          },
          { timestamp: event.timestamp, preserveLastActivity: true },
        );
        session.pendingToolRequest = null;
        continue;
      }

      if (event.type === "intermediate") {
        if (event.value.value.type === "toolResponse") {
          this.emitEvent(
            session,
            {
              type: "tool_response",
              agentName: event.value.agentName,
              toolName: event.value.value.toolResponse.name,
              toolCallId: event.value.value.toolResponse.id,
              response: extractAllTextFromComplexResponse(
                event.value.value.toolResponse.response,
              ),
            },
            {
              timestamp: event.timestamp,
              preserveLastActivity: true,
            },
          );
          continue;
        }

        continue;
      }

      if (event.value.type === "toolRequest") {
        this.emitEvent(
          session,
          {
            type: "tool_request",
            payload: this.toToolRequestPayload(event.value),
            requiresApproval: !session.continuousMode,
          },
          { timestamp: event.timestamp, preserveLastActivity: true },
        );
        session.pendingToolRequest = event.value;
        continue;
      }

      const text = extractAllTextFromComplexResponse(
        event.value.content.content,
      );
      const attachments = await this.registerSharedFiles(
        session,
        event.value.content.sharedFiles ?? [],
      );
      const responseMessageId =
        (event.value.content as { id?: string }).id ?? crypto.randomUUID();
      this.emitEvent(
        session,
        {
          type: "agent_response",
          agentName: event.agentName,
          messageId: responseMessageId,
          markdown: text,
          attachments,
        },
        { timestamp: event.timestamp, preserveLastActivity: true },
      );
      session.pendingToolRequest = null;
    }

    session.lastActivityAt = latestActivity;
  }

  private restorePersistedPluginRuntimeEvents(session: SessionRuntime): void {
    const persistedEvents =
      this.store?.listPluginRuntimeEvents(session.sessionId) ?? [];
    for (const persistedEvent of persistedEvents) {
      this.insertPersistedPluginRuntimeEvent(session, persistedEvent);
    }
    this.trimEventBuffer(session);
  }

  private insertPersistedPluginRuntimeEvent(
    session: SessionRuntime,
    persistedEvent: StoredPluginRuntimeEvent,
  ): void {
    const event = persistedEvent.event;
    if (session.eventBuffer.some((existing) => existing.id === event.id)) {
      return;
    }

    if (event.type === "plugin_event") {
      const toolResponseIndex = session.eventBuffer.findIndex(
        (existing) =>
          existing.type === "tool_response" &&
          existing.toolCallId === event.toolCallId,
      );
      if (toolResponseIndex >= 0) {
        session.eventBuffer.splice(toolResponseIndex, 0, event);
        return;
      }

      const toolRequestIndex = session.eventBuffer.findIndex(
        (existing) =>
          existing.type === "tool_request" &&
          existing.payload.toolCalls.some(
            (toolCall) =>
              toolCall.id === event.toolCallId ||
              (toolCall.id === undefined &&
                toolCall.toolName === event.toolName),
          ),
      );
      if (toolRequestIndex >= 0) {
        session.eventBuffer.splice(toolRequestIndex + 1, 0, event);
        return;
      }

      this.insertEventByTimestamp(session, event);
      return;
    }

    this.insertEventByTimestamp(session, event);
  }

  private insertEventByTimestamp(
    session: SessionRuntime,
    event: SessionEvent,
  ): void {
    const eventTimestampMs = Date.parse(event.timestamp);
    if (!Number.isFinite(eventTimestampMs)) {
      session.eventBuffer.push(event);
      return;
    }

    const insertIndex = session.eventBuffer.findIndex((existing) => {
      const existingTimestampMs = Date.parse(existing.timestamp);
      return (
        Number.isFinite(existingTimestampMs) &&
        existingTimestampMs > eventTimestampMs
      );
    });

    if (insertIndex >= 0) {
      session.eventBuffer.splice(insertIndex, 0, event);
      return;
    }

    session.eventBuffer.push(event);
  }

  private classifyHydratedSharedFiles(sharedFiles: SharedFile[]): {
    workspaceFiles: string[];
    chatImages: string[];
  } {
    const workspaceFiles: string[] = [];
    const chatImages: string[] = [];

    for (const file of sharedFiles) {
      const extension = path.extname(file.fileName).toLowerCase();
      if (
        extension === ".png" ||
        extension === ".jpg" ||
        extension === ".jpeg"
      ) {
        chatImages.push(file.fileName);
        continue;
      }

      workspaceFiles.push(file.fileName);
    }

    return {
      workspaceFiles,
      chatImages,
    };
  }

  private getHydratedInputPresentation(input: AgentInput): {
    origin: UserMessageOrigin;
    text: string;
    workspaceFiles: string[];
    chatImages: string[];
  } {
    if (input.type === "plugin_notification") {
      return {
        origin: this.buildNotificationMessageOrigin(input.notification),
        text: this.buildNotificationProcessingDisplayText(input.notification),
        workspaceFiles: (input.notification.content.sharedFiles ?? []).map(
          (sharedFile) => sharedFile.fileName,
        ),
        chatImages: [],
      };
    }

    const { workspaceFiles, chatImages } = this.classifyHydratedSharedFiles(
      input.message.sharedFiles ?? [],
    );
    return {
      origin: { type: "user" },
      text: extractAllTextFromComplexResponse(input.message.content),
      workspaceFiles,
      chatImages,
    };
  }

  private buildNotificationMessageOrigin(
    notification: AgentNotificationInput,
  ): UserMessageOrigin {
    return {
      type: "plugin_notification",
      notificationId: notification.notificationId,
      pluginId: notification.pluginId,
      pluginPrefix: notification.pluginPrefix,
      pluginNamespace: notification.pluginNamespace,
      title: notification.title,
      summary: notification.summary,
    };
  }

  async createSession(
    name?: string,
    agentName?: string,
  ): Promise<SessionState> {
    const sessionId = crypto.randomUUID();
    const { config, sessionsRoot } = await this.getRuntimeConfig();
    const now = Date.now();
    const paths = this.getSessionPaths(sessionsRoot, sessionId);
    let checkpointer: SqliteSaver | null = null;

    try {
      await fs.mkdir(paths.uploadDirectory, { recursive: true });
      checkpointer = this.createSessionCheckpointer(paths.checkpointerPath);

      const orchestratorBuilder = new OrchestratorBuilder(sessionId);
      const workspaceFactory = async () => {
        await fs.mkdir(paths.workingRoot, { recursive: true });
        const workspace = new FileSystemAgentWorkspace(paths.workingRoot);
        await fs.mkdir(workspace.workingDirectory, { recursive: true });
        return workspace;
      };

      const principalAgentName =
        agentName?.trim() || this.getDefaultAgentName(config);
      if (!principalAgentName) {
        throw new HttpError(
          500,
          "INVALID_CONFIG",
          "No principal agent found in configuration.",
        );
      }
      const pluginRuntime = new SessionPluginRuntimeController(
        principalAgentName,
      );
      const pluginStateStore = new DiskPluginStateStore(
        paths.pluginStateDirectory,
      );
      await pluginStateStore.clear();
      this.configurePluginRuntimeStorage(
        sessionId,
        pluginRuntime,
        pluginStateStore,
      );
      const principal = await this.createAgent(
        config,
        checkpointer,
        orchestratorBuilder,
        workspaceFactory,
        principalAgentName,
        pluginRuntime,
      );

      const finalName =
        name?.trim() ||
        `Chat ${(this.store?.listSessions().length ?? this.sessions.size) + 1}`;

      const session: SessionRuntime = {
        sessionId,
        name: finalName,
        createdAt: now,
        lastActivityAt: now,
        continuousMode: config.continuousMode ?? false,
        agentName: principal.agent.name,
        checkpointer,
        orchestrator: orchestratorBuilder.build(principal.agent),
        pluginRuntime,
        pendingToolRequest: null,
        eventBuffer: [],
        subscribers: new Set<SessionListener>(),
        fileRegistry: new Map(),
        uploadDirectory: paths.uploadDirectory,
        workingRoot: paths.workingRoot,
        cleanupPath: paths.cleanupPath,
        running: false,
        abortController: undefined,
      };

      this.persistSessionMetadata(session);
      this.sessions.set(sessionId, session);
      this.attachPluginRuntime(session);
      this.emitStateChanged(session);
      return this.toSessionState(session);
    } catch (error) {
      checkpointer?.db.close();
      await fs
        .rm(paths.cleanupPath, { recursive: true, force: true })
        .catch(() => {
          return;
        });
      throw error;
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    await this.getRuntimeConfig();
    const summaryBySessionId = new Map<string, SessionSummary>();
    for (const storedSession of this.store?.listSessions() ?? []) {
      summaryBySessionId.set(
        storedSession.sessionId,
        this.buildStoredSessionSummary(storedSession),
      );
    }

    for (const session of this.sessions.values()) {
      summaryBySessionId.set(session.sessionId, this.toSessionSummary(session));
    }

    return [...summaryBySessionId.values()].sort((left, right) =>
      right.lastActivityAt.localeCompare(left.lastActivityAt),
    );
  }

  async getSessionState(sessionId: string): Promise<SessionState> {
    const session = await this.ensureSessionLoaded(sessionId);
    return this.toSessionState(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session =
      this.sessions.get(sessionId) ??
      (await this.sessionHydrationPromises.get(sessionId));
    if (!session) {
      const { sessionsRoot } = await this.getRuntimeConfig();
      const storedSession = this.store?.getSession(sessionId);
      if (!storedSession) {
        throw new HttpError(
          404,
          "SESSION_NOT_FOUND",
          `Session \"${sessionId}\" was not found.`,
        );
      }

      this.store?.deleteSession(sessionId);
      await fs
        .rm(this.getSessionPaths(sessionsRoot, sessionId).cleanupPath, {
          recursive: true,
          force: true,
        })
        .catch(() => {
          return;
        });
      return;
    }

    if (session.running) {
      throw new HttpError(
        409,
        "SESSION_BUSY",
        "Cannot delete a session while it is processing a request.",
      );
    }

    await this.disposeSession(session, { removeCatalog: true });
  }

  async resetSession(sessionId: string): Promise<SessionState> {
    const session = await this.ensureSessionLoaded(sessionId);
    return await this.withSessionLock(session, async () => {
      await session.orchestrator.reset();
      session.pendingToolRequest = null;
      session.pluginRuntime.cancelPendingElicitations();
      session.pluginRuntime.clearNotifications();
      await session.pluginRuntime.clearPluginStates();
      this.store?.clearPluginRuntimeEvents(session.sessionId);
      session.fileRegistry.clear();
      session.eventBuffer = [];
      await fs
        .rm(session.uploadDirectory, { recursive: true, force: true })
        .catch(() => {
          return;
        });
      await fs.mkdir(session.uploadDirectory, { recursive: true });

      this.emitEvent(session, {
        type: "reset",
        message: "Session reset.",
      });

      this.emitStateChanged(session);
      return this.toSessionState(session);
    });
  }

  async stopSession(sessionId: string): Promise<SessionState> {
    const session = await this.ensureSessionLoaded(sessionId);
    session.pluginRuntime.cancelPendingElicitations();
    if (session.running && session.abortController) {
      session.abortController.abort("User requested stop");
    }
    return this.toSessionState(session);
  }

  async setContinuousMode(
    sessionId: string,
    enabled: boolean,
  ): Promise<SessionState> {
    const session = await this.ensureSessionLoaded(sessionId);
    if (session.running) {
      throw new HttpError(
        409,
        "SESSION_BUSY",
        "Cannot change continuous mode while the session is processing.",
      );
    }

    session.continuousMode = enabled;
    session.lastActivityAt = Date.now();
    this.persistSessionMetadata(session);
    this.emitStateChanged(session);
    return this.toSessionState(session);
  }

  async sendMessage(
    sessionId: string,
    input: SendMessageInput,
  ): Promise<SessionState> {
    const session = await this.ensureSessionLoaded(sessionId);
    return await this.withSessionLock(session, async () => {
      if (session.pendingToolRequest) {
        throw new HttpError(
          409,
          "PENDING_APPROVAL",
          "A tool approval decision is required before sending a new message.",
        );
      }

      await this.validateUploadInput(input);
      const { agentInput, workspaceFileNames, chatImageNames } =
        await this.buildInputMessage(session, input);

      if (
        (agentInput.content.length === 0 ||
          extractAllTextFromComplexResponse(agentInput.content).trim()
            .length === 0) &&
        (agentInput.sharedFiles?.length ?? 0) === 0
      ) {
        throw new HttpError(
          400,
          "EMPTY_MESSAGE",
          "Message text or attachments are required.",
        );
      }

      this.emitEvent(session, {
        type: "user_message",
        origin: { type: "user" },
        text: input.text,
        workspaceFiles: workspaceFileNames,
        chatImages: chatImageNames,
      });

      let generator = session.orchestrator.handleMessage(
        {
          input: {
            type: "user_message",
            message: agentInput,
          },
          abortSignal: session.abortController?.signal,
        },
        session.sessionId,
      );
      await this.consumeGenerator(session, generator);
      this.emitStateChanged(session);
      return this.toSessionState(session);
    });
  }

  async processNotifications(sessionId: string): Promise<SessionState> {
    const session = await this.ensureSessionLoaded(sessionId);
    return await this.withSessionLock(session, async () => {
      if (session.pendingToolRequest) {
        throw new HttpError(
          409,
          "PENDING_APPROVAL",
          "A tool approval decision is required before processing notifications.",
        );
      }

      const notification = session.pluginRuntime.nextUnread();
      if (!notification) {
        throw new HttpError(
          409,
          "NO_PENDING_NOTIFICATIONS",
          "There are no pending plugin notifications to process.",
        );
      }

      const notificationInput = this.buildNotificationAgentInput(notification);
      const notificationPresentation =
        this.getHydratedInputPresentation(notificationInput);
      this.emitEvent(session, {
        type: "user_message",
        origin: notificationPresentation.origin,
        text: notificationPresentation.text,
        workspaceFiles: notificationPresentation.workspaceFiles,
        chatImages: notificationPresentation.chatImages,
      });

      const generator = session.orchestrator.handleMessage(
        {
          input: notificationInput,
          abortSignal: session.abortController?.signal,
        },
        session.sessionId,
      );
      await this.consumeGenerator(session, generator);
      session.pluginRuntime.remove([notification.id]);
      this.emitStateChanged(session);
      return this.toSessionState(session);
    });
  }

  async submitApproval(
    sessionId: string,
    request: ApprovalRequest,
  ): Promise<SessionState> {
    const session = await this.ensureSessionLoaded(sessionId);
    return await this.withSessionLock(session, async () => {
      const pending = session.pendingToolRequest;
      if (!pending) {
        throw new HttpError(
          409,
          "NO_PENDING_TOOL_REQUEST",
          "There is no pending tool request to approve or reject.",
        );
      }

      session.pendingToolRequest = null;
      this.emitStateChanged(session);

      if (request.action === "disapprove") {
        const feedback = request.feedback?.trim();
        if (!feedback) {
          throw new HttpError(
            400,
            "MISSING_FEEDBACK",
            "Disapproval requires a feedback message.",
          );
        }

        this.emitEvent(session, {
          type: "user_message",
          origin: { type: "user" },
          text: feedback,
          workspaceFiles: [],
          chatImages: [],
        });

        const generator = session.orchestrator.handleMessage(
          {
            input: {
              type: "user_message",
              message: {
                content: [{ type: "text", text: feedback }],
                sharedFiles: [],
              },
            },
          },
          session.sessionId,
        );
        await this.consumeGenerator(session, generator);
      } else {
        const generator = session.orchestrator.handleMessage(
          {
            input: null,
            abortSignal: session.abortController?.signal,
          },
          session.sessionId,
        );
        await this.consumeGenerator(session, generator);
      }

      this.emitStateChanged(session);
      return this.toSessionState(session);
    });
  }

  async submitElicitationResponse(
    sessionId: string,
    elicitationRequestId: string,
    response: PluginElicitationResponseRequest,
  ): Promise<SessionState> {
    const session = await this.ensureSessionLoaded(sessionId);
    const result = session.pluginRuntime.respondToElicitation(
      elicitationRequestId,
      response,
    );
    if (!result.ok) {
      throw new HttpError(
        result.code === "ELICITATION_NOT_FOUND" ? 404 : 400,
        result.code,
        result.message,
      );
    }

    this.emitStateChanged(session);
    return this.toSessionState(session);
  }

  async subscribe(
    sessionId: string,
    listener: SessionListener,
  ): Promise<SessionSubscription> {
    const session = await this.ensureSessionLoaded(sessionId);
    session.subscribers.add(listener);
    session.lastActivityAt = Date.now();

    return {
      state: this.toSessionState(session),
      backlog: [...session.eventBuffer],
      unsubscribe: () => {
        session.subscribers.delete(listener);
      },
    };
  }

  async resolveFile(
    sessionId: string,
    fileId: string,
  ): Promise<SessionFileRecord> {
    const session = await this.ensureSessionLoaded(sessionId);
    const found = session.fileRegistry.get(fileId);
    if (!found) {
      throw new HttpError(
        404,
        "FILE_NOT_FOUND",
        "File not found for this session.",
      );
    }

    const exists = await fs
      .access(found.absolutePath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new HttpError(
        404,
        "FILE_NOT_FOUND",
        "File no longer exists on disk.",
      );
    }

    return found;
  }

  async listPluginStates(sessionId: string): Promise<PluginStateSummary[]> {
    const session = await this.ensureSessionLoaded(sessionId);
    return await session.pluginRuntime.listPluginStates();
  }

  async getPluginState(
    sessionId: string,
    pluginInstanceId: string,
    publicApiBasePath: string,
  ): Promise<PluginStateDetail> {
    const session = await this.ensureSessionLoaded(sessionId);
    const state = await session.pluginRuntime.readPluginState(pluginInstanceId);
    if (!state) {
      throw new HttpError(
        404,
        "PLUGIN_STATE_NOT_FOUND",
        `Plugin state for "${pluginInstanceId}" was not found.`,
      );
    }

    return {
      pluginInstanceId: state.pluginInstanceId,
      pluginId: state.pluginId,
      pluginPrefix: state.pluginPrefix,
      pluginNamespace: state.pluginNamespace,
      agentName: state.agentName,
      updatedAt: state.updatedAt,
      revision: state.revision,
      markdown: this.rewritePluginStateAssetUrls(state.markdown, {
        sessionId,
        pluginInstanceId: state.pluginInstanceId,
        revision: state.revision,
        publicApiBasePath,
      }),
    };
  }

  async resolvePluginStateAsset(
    sessionId: string,
    pluginInstanceId: string,
    revision: string,
    assetId: string,
  ): Promise<PluginStateAssetFileRecord> {
    const session = await this.ensureSessionLoaded(sessionId);
    const asset = await session.pluginRuntime.resolvePluginStateAsset(
      pluginInstanceId,
      revision,
      assetId,
    );
    if (!asset) {
      throw new HttpError(
        404,
        "PLUGIN_STATE_ASSET_NOT_FOUND",
        "Plugin state asset was not found.",
      );
    }

    const exists = await fs
      .access(asset.absolutePath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new HttpError(
        404,
        "PLUGIN_STATE_ASSET_NOT_FOUND",
        "Plugin state asset no longer exists.",
      );
    }

    return asset;
  }

  private async createAgent(
    config: AgentMimirConfig,
    checkpointer: BaseCheckpointSaver,
    builder: OrchestratorBuilder,
    workspaceFactory: (agentName: string) => Promise<FileSystemAgentWorkspace>,
    agentName: string,
    pluginRuntime: PluginRuntimeProvider,
  ): Promise<AgentDefinitionRuntime> {
    const agentDefinition = config.agents[agentName];
    if (!agentDefinition) {
      throw new HttpError(
        404,
        "AGENT_NOT_FOUND",
        `Agent \"${agentName}\" is not registered in configuration.`,
      );
    }
    if (!agentDefinition.definition) {
      throw new HttpError(
        500,
        "INVALID_CONFIG",
        `Agent \"${agentName}\" has no definition.`,
      );
    }

    const definition = agentDefinition.definition;
    // const factory = new CodeAgentFactory({
    //     description: agentDefinition.description,
    //     profession: definition.profession,
    //     model: definition.chatModel,
    //     checkpointer: checkpointer,
    //     visionSupport: definition.visionSupport,
    //     constitution: definition.constitution,
    //     plugins: definition.plugins ?? [],
    //     codeExecutor: (workspace) => new DockerPythonExecutor({ additionalPackages: [], workspace: workspace }),
    //     workspaceFactory
    // });
    const factory = new FunctionAgentFactory({
      description: agentDefinition.description,
      profession: definition.profession,
      model: definition.chatModel,
      checkpointer: checkpointer,
      visionSupport: definition.visionSupport,
      constitution: definition.constitution,
      plugins: definition.plugins ?? [],
      workspaceFactory,
      pluginRuntime,
    });
    const initialized = await builder.initializeAgent(factory, agentName);

    return {
      mainAgent: agentDefinition.mainAgent,
      name: agentName,
      agent: initialized,
    } satisfies AgentDefinitionRuntime;
  }

  private async validateUploadInput(input: SendMessageInput) {
    const fileCount = input.workspaceFiles.length + input.chatImages.length;
    if (fileCount > this.uploadLimits.maxFilesPerTurn) {
      throw new HttpError(
        400,
        "TOO_MANY_FILES",
        `A maximum of ${this.uploadLimits.maxFilesPerTurn} files are allowed per message.`,
      );
    }

    const allFiles = [...input.workspaceFiles, ...input.chatImages];
    for (const file of allFiles) {
      const byteLength = await this.resolveUploadByteLength(file);
      if (byteLength > this.uploadLimits.maxFileSizeBytes) {
        throw new HttpError(
          400,
          "FILE_TOO_LARGE",
          `File ${file.fileName} exceeds ${this.uploadLimits.maxFileSizeBytes / (1024 * 1024)}MB.`,
        );
      }
    }

    for (const image of input.chatImages) {
      if (!this.isImageMimeType(image.contentType)) {
        throw new HttpError(
          422,
          "UNSUPPORTED_CHAT_IMAGE",
          `Unsupported chat image type: ${image.contentType || "unknown"}.`,
        );
      }
    }
  }

  private async buildInputMessage(
    session: SessionRuntime,
    input: SendMessageInput,
  ): Promise<{
    agentInput: InputAgentMessage;
    workspaceFileNames: string[];
    chatImageNames: string[];
  }> {
    const sharedFiles: SharedFile[] = [];
    const usedNames = new Set<string>();
    const workspaceFileNames: string[] = [];
    const chatImageNames: string[] = [];

    const writeUpload = async (
      upload: UploadInput,
      fallbackPrefix: string,
    ): Promise<SharedFile> => {
      const safeFileName = this.makeUniqueFileName(
        usedNames,
        this.sanitizeFileName(upload.fileName, fallbackPrefix),
      );
      const storedPath = path.join(
        session.uploadDirectory,
        `${crypto.randomUUID()}-${safeFileName}`,
      );
      await fs.mkdir(session.uploadDirectory, { recursive: true });
      await this.persistUploadToPath(upload, storedPath);

      return {
        fileName: safeFileName,
        url: storedPath,
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
      const bytes = await this.readUploadBytes(image);
      chatImageContent.push({
        type: "image",
        data: bytes.toString("base64"),
        mimeType: mimeType,
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
        sharedFiles,
      },
      workspaceFileNames,
      chatImageNames,
    };
  }

  private buildNotificationAgentInput(
    notification: PluginNotification,
  ): AgentInput {
    return {
      type: "plugin_notification",
      notification: {
        notificationId: notification.id,
        pluginId: notification.pluginId,
        pluginPrefix: notification.pluginPrefix,
        pluginNamespace: notification.pluginNamespace,
        title: notification.title,
        summary: notification.summary,
        content: notification.content,
      },
    };
  }

  private buildNotificationProcessingDisplayText(
    notification: AgentNotificationInput,
  ): string {
    return `Process plugin notification: ${notification.title}`;
  }

  private rewritePluginStateAssetUrls(
    markdown: string,
    args: {
      sessionId: string;
      pluginInstanceId: string;
      revision: string;
      publicApiBasePath: string;
    },
  ): string {
    return markdown.replace(
      /asset:\/\/([A-Za-z0-9._-]+)/g,
      (_match, assetId: string) => {
        const sessionId = encodeURIComponent(args.sessionId);
        const pluginInstanceId = encodeURIComponent(args.pluginInstanceId);
        const revision = encodeURIComponent(args.revision);
        const encodedAssetId = encodeURIComponent(assetId);
        return `${args.publicApiBasePath}/sessions/${sessionId}/plugin-states/${pluginInstanceId}/assets/${revision}/${encodedAssetId}`;
      },
    );
  }

  private async resolveUploadByteLength(upload: UploadInput): Promise<number> {
    if (upload.bytes !== undefined) {
      return upload.bytes.byteLength;
    }

    const filePath = upload.filePath;
    if (!filePath) {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        `Upload file ${upload.fileName} could not be read.`,
      );
    }

    try {
      const fileStats = await fs.stat(filePath);
      return fileStats.size;
    } catch {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        `Upload file ${upload.fileName} could not be read.`,
      );
    }
  }

  private async readUploadBytes(upload: UploadInput): Promise<Buffer> {
    if (upload.bytes !== undefined) {
      return upload.bytes;
    }

    const filePath = upload.filePath;
    if (!filePath) {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        `Upload file ${upload.fileName} could not be read.`,
      );
    }

    try {
      return await fs.readFile(filePath);
    } catch {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        `Upload file ${upload.fileName} could not be read.`,
      );
    }
  }

  private async persistUploadToPath(
    upload: UploadInput,
    destinationPath: string,
  ): Promise<void> {
    if (upload.bytes !== undefined) {
      await fs.writeFile(destinationPath, upload.bytes);
      return;
    }

    const filePath = upload.filePath;
    if (!filePath) {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        `Upload file ${upload.fileName} could not be saved.`,
      );
    }

    try {
      await fs.copyFile(filePath, destinationPath);
    } catch {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        `Upload file ${upload.fileName} could not be saved.`,
      );
    }
  }

  private async consumeGenerator(
    session: SessionRuntime,
    generator: AsyncGenerator<
      IntermediateAgentResponse,
      HandleMessageResult,
      void
    >,
  ) {
    let result: IteratorResult<IntermediateAgentResponse, HandleMessageResult>;

    while (true) {
      while (!(result = await generator.next()).done) {
        await this.handleIntermediateResponse(session, result.value);
      }

      if (result.value.type === "agentResponse") {
        const text = extractAllTextFromComplexResponse(
          result.value.content.content,
        );
        const attachments = await this.registerSharedFiles(
          session,
          result.value.content.sharedFiles ?? [],
        );
        const responseMessageId =
          (result.value.content as { id?: string }).id ?? crypto.randomUUID();
        this.emitEvent(session, {
          type: "agent_response",
          agentName: session.orchestrator.currentAgent.name,
          messageId: responseMessageId,
          markdown: text,
          attachments,
        });
        return;
      }

      const pending = result.value;
      const pendingPayload = this.toToolRequestPayload(pending);
      this.emitEvent(session, {
        type: "tool_request",
        payload: pendingPayload,
        requiresApproval: !session.continuousMode,
      });

      if (!session.continuousMode) {
        session.pendingToolRequest = pending;
        return;
      }

      generator = session.orchestrator.handleMessage(
        {
          input: null,
        },
        session.sessionId,
      );
    }
  }

  private async handleIntermediateResponse(
    session: SessionRuntime,
    chainResponse: IntermediateAgentResponse,
  ) {
    if (chainResponse.value.type === "messageChunk") {
      const chunkText = extractAllTextFromComplexResponse(
        chainResponse.value.content,
      );
      if (chunkText.length === 0) {
        return;
      }

      this.emitEvent(session, {
        type: "agent_response_chunk",
        agentName: chainResponse.agentName,
        messageId: chainResponse.value.id,
        markdownChunk: chunkText,
      });
      return;
    }

    if (chainResponse.value.type === "toolResponse") {
      this.emitEvent(session, {
        type: "tool_response",
        messageId: chainResponse.value.id,
        agentName: chainResponse.agentName,
        toolName: chainResponse.value.toolResponse.name,
        toolCallId: chainResponse.value.toolResponse.id,
        response: extractAllTextFromComplexResponse(
          chainResponse.value.toolResponse.response,
        ),
      });
      return;
    }
  }

  private async registerSharedFiles(
    session: SessionRuntime,
    sharedFiles: SharedFile[],
  ): Promise<DownloadableFile[]> {
    const results: DownloadableFile[] = [];

    for (const file of sharedFiles) {
      const fileId = crypto.randomUUID();
      session.fileRegistry.set(fileId, {
        fileId,
        fileName: file.fileName,
        absolutePath: file.url,
      });

      results.push({
        fileId,
        fileName: file.fileName,
      });
    }

    return results;
  }

  private toToolRequestPayload(
    toolRequest: AgentToolRequestTwo,
  ): ToolRequestPayload {
    return {
      messageId: toolRequest.id,
      callingAgent: toolRequest.callingAgent,
      content: extractAllTextFromComplexResponse(toolRequest.content),
      toolCalls: (toolRequest.toolCalls ?? []).map((toolCall) => ({
        id: toolCall.id,
        toolName: toolCall.toolName,
        input: toolCall.input,
      })),
    };
  }

  private configurePluginRuntimeStorage(
    sessionId: string,
    pluginRuntime: SessionPluginRuntimeController,
    pluginStateStore: DiskPluginStateStore,
  ): void {
    pluginRuntime.configure({
      stateStore: pluginStateStore,
      persistence: {
        saveNotification: (notification) => {
          this.store?.savePluginNotification(sessionId, notification);
        },
        deleteNotifications: (notificationIds) => {
          this.store?.deletePluginNotifications(sessionId, notificationIds);
        },
        clearNotifications: () => {
          this.store?.clearPluginNotifications(sessionId);
        },
      },
    });
  }

  private attachPluginRuntime(session: SessionRuntime) {
    session.pluginRuntime.attach({
      emitEvent: (event) => this.emitPluginRuntimeEvent(session, event),
      emitStateChanged: () => this.emitStateChanged(session),
    });
  }

  private emitStateChanged(session: SessionRuntime) {
    this.emitEvent(session, {
      type: "state_changed",
      state: this.toSessionState(session),
    });
  }

  private emitPluginRuntimeEvent(
    session: SessionRuntime,
    event: PluginRuntimeSessionEventPayload,
  ): void {
    if (event.type === "plugin_state" || event.type === "plugin_log") {
      this.emitTransientEvent(session, event);
      return;
    }

    this.emitEvent(session, event);
  }

  private emitTransientEvent(
    session: SessionRuntime,
    event: SessionEventPayload,
    options: EmitEventOptions = {},
  ) {
    const enriched = {
      ...event,
      id: crypto.randomUUID(),
      sessionId: session.sessionId,
      timestamp: options.timestamp ?? new Date().toISOString(),
    } as unknown as SessionEvent;

    for (const listener of session.subscribers) {
      listener(enriched);
    }
  }

  private emitEvent(
    session: SessionRuntime,
    event: SessionEventPayload,
    options: EmitEventOptions = {},
  ) {
    const eventTimestamp = options.timestamp ?? new Date().toISOString();
    const enriched = {
      ...event,
      id: crypto.randomUUID(),
      sessionId: session.sessionId,
      timestamp: eventTimestamp,
    } as unknown as SessionEvent;

    if (!options.preserveLastActivity) {
      session.lastActivityAt = Date.now();
      this.store?.updateSessionActivity(
        session.sessionId,
        session.lastActivityAt,
      );
    }
    if (
      enriched.type === "agent_response" ||
      enriched.type === "tool_response" ||
      enriched.type === "tool_request"
    ) {
      let messageIdStr: string | undefined;
      if (enriched.type === "tool_request") {
        messageIdStr = (enriched as any).payload?.messageId;
      } else {
        messageIdStr = (enriched as any).messageId;
      }

      if (messageIdStr) {
        session.eventBuffer = session.eventBuffer.filter(
          (e) =>
            e.type !== "agent_response_chunk" ||
            (e as any).messageId !== messageIdStr,
        );
      }
    }

    session.eventBuffer.push(enriched);
    this.persistPluginRuntimeEvent(session, enriched);
    this.trimEventBuffer(session);

    for (const listener of session.subscribers) {
      listener(enriched);
    }
  }

  private persistPluginRuntimeEvent(
    session: SessionRuntime,
    event: SessionEvent,
  ): void {
    if (
      event.type !== "plugin_event" &&
      event.type !== "plugin_notification" &&
      event.type !== "plugin_elicitation_request" &&
      event.type !== "plugin_elicitation_response" &&
      event.type !== "plugin_elicitation_complete"
    ) {
      return;
    }

    this.store?.appendPluginRuntimeEvent(session.sessionId, event, {
      retentionLimit: SESSION_EVENT_CAP,
    });
  }

  private trimEventBuffer(session: SessionRuntime): void {
    let structuralCount = 0;
    for (const e of session.eventBuffer) {
      if (e.type !== "agent_response_chunk") {
        structuralCount++;
      }
    }

    while (structuralCount > SESSION_EVENT_CAP) {
      const targetIndex = session.eventBuffer.findIndex(
        (e) => e.type !== "agent_response_chunk",
      );
      if (targetIndex !== -1) {
        session.eventBuffer.splice(targetIndex, 1);
        structuralCount--;
      } else {
        break;
      }
    }

    const MAX_BUFFER_SIZE = SESSION_EVENT_CAP * 20;
    while (session.eventBuffer.length > MAX_BUFFER_SIZE) {
      session.eventBuffer.shift();
    }
  }

  private async withSessionLock<T>(
    session: SessionRuntime,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (session.running) {
      throw new HttpError(
        409,
        "SESSION_BUSY",
        "Session is already processing another request.",
      );
    }

    session.running = true;
    session.abortController = new AbortController();
    session.lastActivityAt = Date.now();

    try {
      return await operation();
    } catch (error) {
      const normalized =
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              "INTERNAL_ERROR",
              error instanceof Error ? error.message : "Unexpected error",
            );
      this.emitEvent(session, {
        type: "error",
        message: normalized.message,
        code: normalized.code,
      });
      throw normalized;
    } finally {
      session.running = false;
      session.abortController = undefined;
      session.lastActivityAt = Date.now();
      this.emitStateChanged(session);
    }
  }

  private requireSession(sessionId: string): SessionRuntime {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new HttpError(
        404,
        "SESSION_NOT_FOUND",
        `Session \"${sessionId}\" was not found.`,
      );
    }

    return session;
  }

  private toStoredSessionRecord(session: SessionRuntime): StoredSessionRecord {
    return {
      sessionId: session.sessionId,
      name: session.name,
      createdAtMs: session.createdAt,
      lastActivityAtMs: session.lastActivityAt,
      agentName: session.agentName,
      continuousMode: session.continuousMode,
    };
  }

  private persistSessionMetadata(session: SessionRuntime): void {
    this.store?.upsertSession(this.toStoredSessionRecord(session));
  }

  private toSessionSummary(session: SessionRuntime): SessionSummary {
    return {
      sessionId: session.sessionId,
      name: session.name,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivityAt: new Date(session.lastActivityAt).toISOString(),
      agentName: session.agentName,
      continuousMode: session.continuousMode,
      hasPendingToolRequest: session.pendingToolRequest !== null,
    };
  }

  private toSessionState(session: SessionRuntime): SessionState {
    return {
      ...this.toSessionSummary(session),
      pendingToolRequest: session.pendingToolRequest
        ? this.toToolRequestPayload(session.pendingToolRequest)
        : undefined,
      pendingNotificationCount: session.pluginRuntime.unreadCount(),
      pendingElicitations: session.pluginRuntime.listPendingElicitations(),
    };
  }

  private isImageMimeType(mimeType: string): boolean {
    const normalized = mimeType.toLowerCase();
    return (
      normalized === "image/png" ||
      normalized === "image/jpeg" ||
      normalized === "image/jpg"
    );
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
    const expired = [...this.sessions.values()].filter(
      (session) =>
        !session.running &&
        session.subscribers.size === 0 &&
        now - session.lastActivityAt > this.sessionTtlMs,
    );

    for (const session of expired) {
      await this.suspendSessionRuntime(session);
    }
  }

  async shutDown(): Promise<void> {
    clearInterval(this.cleanupTimer);
    const activeSessions = [...this.sessions.values()];
    for (const session of activeSessions) {
      await this.suspendSessionRuntime(session);
    }
    this.store?.close();
  }

  private async suspendSessionRuntime(session: SessionRuntime): Promise<void> {
    this.sessions.delete(session.sessionId);
    this.sessionHydrationPromises.delete(session.sessionId);
    session.subscribers.clear();
    session.pluginRuntime.cancelPendingElicitations();
    session.pluginRuntime.detach();
    await session.pluginRuntime.clearPluginStates();
    await session.orchestrator.shutDown();
    session.checkpointer.db.close();
  }

  private async disposeSession(
    session: SessionRuntime,
    options: { removeCatalog?: boolean } = {},
  ): Promise<void> {
    await this.suspendSessionRuntime(session);
    if (options.removeCatalog) {
      this.store?.deleteSession(session.sessionId);
    }
    await fs
      .rm(session.cleanupPath, { recursive: true, force: true })
      .catch(() => {
        return;
      });
  }
}

export function createSessionManager(
  options: SessionManagerOptions = {},
): SessionManager {
  return new SessionManager(options);
}

export type {
  UploadInput,
  SendMessageInput,
  UploadLimits,
  SessionManagerOptions,
};
