import type { SessionEvent } from "../contracts.js";
import type {
  ElicitationPropertySchema,
  ElicitationRequestedSchema,
  PluginElicitationCompleteInput,
  PluginElicitationCreateRequest,
  PluginNotification,
  PluginNotificationInput,
  PluginEventInput,
  PluginElicitationResponse,
  PluginRuntimeBinding,
  PluginRuntimeEventInput,
  PluginRuntimeBindingIdentity,
  PluginRuntimeProvider,
} from "@mimir/agent-core/plugins";
import type {
  PluginElicitationPayload,
  PluginElicitationResponseRequest,
} from "../contracts.js";
import type { ToolCallRuntimeSource } from "@mimir/agent-core/tools";
import crypto from "crypto";
import type {
  DiskPluginStateStore,
  PluginStateAssetFile,
  StoredPluginStateDetail,
} from "./plugin-state-store.js";

type SessionPluginRuntimeEvent =
  Extract<
    SessionEvent,
    {
      type:
        | "plugin_event"
        | "plugin_notification"
        | "plugin_state"
        | "plugin_log"
        | "plugin_elicitation_request"
        | "plugin_elicitation_response"
        | "plugin_elicitation_complete";
    }
  > extends infer T
    ? T extends unknown
      ? Omit<T, "id" | "sessionId" | "timestamp">
      : never
    : never;

type PluginRuntimeIdentity = {
  pluginInstanceId: string;
} & PluginRuntimeBindingIdentity;

export type RuntimePluginNotification = PluginNotification & {
  pluginInstanceId: string;
};

type PendingPluginElicitation = {
  payload: PluginElicitationPayload;
  resolve(response: PluginElicitationResponse): void;
};

export type PluginElicitationResolutionResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: "ELICITATION_NOT_FOUND" | "INVALID_ELICITATION_RESPONSE";
      message: string;
    };

export type SessionPluginRuntimeSink = {
  emitEvent(event: SessionPluginRuntimeEvent): void;
  emitStateChanged(): void;
};

export type SessionPluginRuntimePersistence = {
  saveNotification(notification: RuntimePluginNotification): void;
  deleteNotifications(notificationIds: string[]): void;
  clearNotifications(): void;
};

export type SessionPluginRuntimeAccessors = {
  persistence?: SessionPluginRuntimePersistence;
  stateStore?: DiskPluginStateStore;
};

export class SessionPluginRuntimeController implements PluginRuntimeProvider {
  private sink: SessionPluginRuntimeSink | undefined;
  private bufferedEvents: SessionPluginRuntimeEvent[] = [];
  private notifications: RuntimePluginNotification[] = [];
  private pendingElicitations = new Map<string, PendingPluginElicitation>();
  private persistedNotificationIds = new Set<string>();
  private accessors: SessionPluginRuntimeAccessors = {};

  constructor(
    private readonly agentName: string,
    initialNotifications: RuntimePluginNotification[] = [],
  ) {
    this.notifications = [...initialNotifications];
    this.persistedNotificationIds = new Set(
      initialNotifications.map((notification) => notification.id),
    );
  }

  configure(accessors: SessionPluginRuntimeAccessors): void {
    this.accessors = accessors;
    this.persistUnstoredNotifications();
  }

  attach(sink: SessionPluginRuntimeSink): void {
    this.sink = sink;
    const bufferedEvents = this.bufferedEvents;
    this.bufferedEvents = [];

    for (const event of bufferedEvents) {
      sink.emitEvent(event);
    }

    if (this.unreadCount() > 0 || this.pendingElicitations.size > 0) {
      sink.emitStateChanged();
    }
  }

  detach(): void {
    this.sink = undefined;
  }

  bindPlugin(
    identityInput: PluginRuntimeBindingIdentity,
  ): PluginRuntimeBinding {
    const identity: PluginRuntimeIdentity = {
      pluginInstanceId: crypto.randomUUID(),
      ...identityInput,
    };

    return {
      runtime: {
        notifications: {
          enqueue: (input) => this.enqueueNotification(identity, input),
        },
        events: {
          emit: (input) => this.emitPluginEvent(identity, input),
        },
        elicitation: {
          create: (input) => this.createPluginElicitation(identity, input),
          complete: (input) => this.completePluginElicitation(identity, input),
        },
      },
      toolRuntime: {
        forToolCall: (source) => ({
          ...source,
          emitEvent: (input) => this.emitToolCallEvent(identity, source, input),
        }),
      },
    };
  }

  unreadCount(): number {
    return this.notifications.length;
  }

  listUnread(): PluginNotification[] {
    return this.notifications.map((notification) =>
      this.toPluginNotification(notification),
    );
  }

  nextUnread(): PluginNotification | null {
    const notification = this.notifications[0];
    return notification ? this.toPluginNotification(notification) : null;
  }

  listPendingElicitations(): PluginElicitationPayload[] {
    return [...this.pendingElicitations.values()].map((entry) => entry.payload);
  }

  respondToElicitation(
    elicitationRequestId: string,
    response: PluginElicitationResponseRequest,
  ): PluginElicitationResolutionResult {
    const pending = this.pendingElicitations.get(elicitationRequestId);
    if (!pending) {
      return {
        ok: false,
        code: "ELICITATION_NOT_FOUND",
        message: "There is no pending elicitation with that id.",
      };
    }

    const validation = this.normalizeElicitationResponse(
      pending.payload.request,
      response,
    );
    if (!validation.ok) {
      return validation;
    }

    this.pendingElicitations.delete(elicitationRequestId);
    pending.resolve(validation.response);
    this.emitRuntimeEvent({
      type: "plugin_elicitation_response",
      elicitationRequestId,
      pluginInstanceId: pending.payload.pluginInstanceId,
      pluginId: pending.payload.pluginId,
      pluginPrefix: pending.payload.pluginPrefix,
      pluginNamespace: pending.payload.pluginNamespace,
      agentName: pending.payload.agentName,
      action: validation.response.action,
      ...(validation.response.action === "accept" &&
      validation.response.content !== undefined
        ? { content: validation.response.content }
        : {}),
    });
    this.sink?.emitStateChanged();
    return { ok: true };
  }

  cancelPendingElicitations(): void {
    if (this.pendingElicitations.size === 0) {
      return;
    }

    const pending = [...this.pendingElicitations.values()];
    this.pendingElicitations.clear();
    for (const entry of pending) {
      entry.resolve({ action: "cancel" });
      this.emitRuntimeEvent({
        type: "plugin_elicitation_response",
        elicitationRequestId: entry.payload.elicitationRequestId,
        pluginInstanceId: entry.payload.pluginInstanceId,
        pluginId: entry.payload.pluginId,
        pluginPrefix: entry.payload.pluginPrefix,
        pluginNamespace: entry.payload.pluginNamespace,
        agentName: entry.payload.agentName,
        action: "cancel",
      });
    }
    this.sink?.emitStateChanged();
  }

  remove(notificationIds: string[]): void {
    const ids = new Set(notificationIds);
    const previousCount = this.notifications.length;
    this.notifications = this.notifications.filter(
      (notification) => !ids.has(notification.id),
    );

    if (this.notifications.length !== previousCount) {
      for (const id of ids) {
        this.persistedNotificationIds.delete(id);
      }
      this.accessors.persistence?.deleteNotifications(notificationIds);
      this.sink?.emitStateChanged();
    }
  }

  clearNotifications(): void {
    if (this.notifications.length === 0) {
      return;
    }

    this.notifications = [];
    this.persistedNotificationIds.clear();
    this.accessors.persistence?.clearNotifications();
    this.sink?.emitStateChanged();
  }

  async clearPluginStates(): Promise<void> {
    await this.accessors.stateStore?.clear();
  }

  async listPluginStates() {
    return (await this.accessors.stateStore?.listStates()) ?? [];
  }

  async readPluginState(
    pluginInstanceId: string,
  ): Promise<StoredPluginStateDetail | null> {
    return (
      (await this.accessors.stateStore?.readState(pluginInstanceId)) ?? null
    );
  }

  async resolvePluginStateAsset(
    pluginInstanceId: string,
    revision: string,
    assetId: string,
  ): Promise<PluginStateAssetFile | null> {
    return (
      (await this.accessors.stateStore?.resolveAsset(
        pluginInstanceId,
        revision,
        assetId,
      )) ?? null
    );
  }

  private emitToolCallEvent(
    identity: PluginRuntimeIdentity,
    source: ToolCallRuntimeSource,
    input: PluginRuntimeEventInput,
  ): void {
    this.emitRuntimeEvent({
      type: "plugin_event",
      toolCallId: source.toolCallId,
      toolName: source.toolName,
      pluginInstanceId: identity.pluginInstanceId,
      pluginId: identity.pluginId,
      pluginPrefix: identity.pluginPrefix,
      pluginNamespace: identity.pluginNamespace,
      agentName: this.agentName,
      visibility: input.visibility ?? "user",
      body: input.body,
    });
  }

  private async createPluginElicitation(
    identity: PluginRuntimeIdentity,
    input: PluginElicitationCreateRequest,
  ): Promise<PluginElicitationResponse> {
    const request = this.normalizeElicitationCreateRequest(input);
    const payload: PluginElicitationPayload = {
      elicitationRequestId: crypto.randomUUID(),
      pluginInstanceId: identity.pluginInstanceId,
      pluginId: identity.pluginId,
      pluginPrefix: identity.pluginPrefix,
      pluginNamespace: identity.pluginNamespace,
      agentName: this.agentName,
      createdAt: new Date().toISOString(),
      request,
    };

    return await new Promise<PluginElicitationResponse>((resolve) => {
      this.pendingElicitations.set(payload.elicitationRequestId, {
        payload,
        resolve,
      });
      this.emitRuntimeEvent({
        type: "plugin_elicitation_request",
        payload,
      });
      this.sink?.emitStateChanged();
    });
  }

  private completePluginElicitation(
    identity: PluginRuntimeIdentity,
    input: PluginElicitationCompleteInput,
  ): void {
    const matching = [...this.pendingElicitations.values()].find(
      (entry) =>
        entry.payload.pluginInstanceId === identity.pluginInstanceId &&
        entry.payload.request.mode === "url" &&
        entry.payload.request.elicitationId === input.elicitationId,
    );
    if (!matching) {
      return;
    }

    this.emitRuntimeEvent({
      type: "plugin_elicitation_complete",
      elicitationRequestId: matching.payload.elicitationRequestId,
      pluginInstanceId: identity.pluginInstanceId,
      pluginId: identity.pluginId,
      pluginPrefix: identity.pluginPrefix,
      pluginNamespace: identity.pluginNamespace,
      agentName: this.agentName,
      elicitationId: input.elicitationId,
    });
  }

  private async emitPluginEvent(
    identity: PluginRuntimeIdentity,
    input: PluginEventInput,
  ): Promise<void> {
    if (input.type === "LOG") {
      this.emitRuntimeEvent(
        {
          type: "plugin_log",
          pluginInstanceId: identity.pluginInstanceId,
          pluginId: identity.pluginId,
          pluginPrefix: identity.pluginPrefix,
          pluginNamespace: identity.pluginNamespace,
          agentName: this.agentName,
          text: input.text,
        },
        { bufferBeforeAttach: false },
      );
      return;
    }

    const summary = await this.accessors.stateStore?.writeState(
      identity.pluginInstanceId,
      {
        pluginId: identity.pluginId,
        pluginPrefix: identity.pluginPrefix,
        pluginNamespace: identity.pluginNamespace,
      },
      this.agentName,
      {
        markdown: input.markdown,
        assets: input.assets,
      },
    );
    if (!summary) {
      return;
    }

    this.emitRuntimeEvent({
      type: "plugin_state",
      pluginInstanceId: summary.pluginInstanceId,
      pluginId: summary.pluginId,
      pluginPrefix: summary.pluginPrefix,
      pluginNamespace: summary.pluginNamespace,
      agentName: summary.agentName,
      updatedAt: summary.updatedAt,
      revision: summary.revision,
    });
  }

  private async enqueueNotification(
    identity: PluginRuntimeIdentity,
    input: PluginNotificationInput,
  ): Promise<PluginNotification> {
    const deduplicationId = this.normalizeDeduplicationId(
      input.deduplicationId,
    );
    if (deduplicationId) {
      const existingNotification = this.notifications.find(
        (notification) =>
          notification.pluginInstanceId === identity.pluginInstanceId &&
          notification.deduplicationId === deduplicationId,
      );
      if (existingNotification) {
        return this.toPluginNotification(existingNotification);
      }
    }

    const notification: RuntimePluginNotification = {
      id: crypto.randomUUID(),
      pluginInstanceId: identity.pluginInstanceId,
      pluginId: identity.pluginId,
      pluginPrefix: identity.pluginPrefix,
      pluginNamespace: identity.pluginNamespace,
      agentName: this.agentName,
      createdAt: Date.now(),
      title: input.title,
      summary: input.summary,
      deduplicationId,
      content: input.content,
    };

    this.notifications.push(notification);
    this.persistNotification(notification);
    this.emitRuntimeEvent({
      type: "plugin_notification",
      notificationId: notification.id,
      pluginInstanceId: identity.pluginInstanceId,
      pluginId: identity.pluginId,
      pluginPrefix: identity.pluginPrefix,
      pluginNamespace: identity.pluginNamespace,
      agentName: this.agentName,
      title: notification.title,
      summary: notification.summary,
      deduplicationId: notification.deduplicationId,
      unreadCount: this.unreadCount(),
    });
    this.sink?.emitStateChanged();
    return this.toPluginNotification(notification);
  }

  private normalizeDeduplicationId(
    deduplicationId: string | undefined,
  ): string | undefined {
    if (typeof deduplicationId !== "string") {
      return undefined;
    }

    const trimmed = deduplicationId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private persistUnstoredNotifications(): void {
    if (!this.accessors.persistence) {
      return;
    }

    for (const notification of this.notifications) {
      this.persistNotification(notification);
    }
  }

  private persistNotification(notification: RuntimePluginNotification): void {
    if (
      !this.accessors.persistence ||
      this.persistedNotificationIds.has(notification.id)
    ) {
      return;
    }

    this.accessors.persistence.saveNotification(notification);
    this.persistedNotificationIds.add(notification.id);
  }

  private toPluginNotification(
    notification: RuntimePluginNotification,
  ): PluginNotification {
    const { pluginInstanceId: _pluginInstanceId, ...publicNotification } =
      notification;
    return publicNotification;
  }

  private emitRuntimeEvent(
    event: SessionPluginRuntimeEvent,
    options: { bufferBeforeAttach?: boolean } = {},
  ): void {
    if (!this.sink) {
      if (options.bufferBeforeAttach ?? true) {
        this.bufferedEvents.push(event);
      }
      return;
    }

    this.sink.emitEvent(event);
  }

  private normalizeElicitationCreateRequest(
    input: PluginElicitationCreateRequest,
  ): PluginElicitationCreateRequest {
    if (!input || typeof input !== "object") {
      throw new Error("Elicitation request must be an object.");
    }
    if (
      typeof input.message !== "string" ||
      input.message.trim().length === 0
    ) {
      throw new Error("Elicitation request message is required.");
    }

    if (input.mode === "url") {
      if (
        typeof input.elicitationId !== "string" ||
        input.elicitationId.trim().length === 0
      ) {
        throw new Error("URL elicitation requires elicitationId.");
      }
      try {
        new URL(input.url);
      } catch {
        throw new Error("URL elicitation requires a valid URL.");
      }
      return {
        mode: "url",
        message: input.message,
        url: input.url,
        elicitationId: input.elicitationId,
      };
    }

    this.validateRequestedSchema(input.requestedSchema);
    return {
      mode: "form",
      message: input.message,
      requestedSchema: input.requestedSchema,
    };
  }

  private normalizeElicitationResponse(
    request: PluginElicitationCreateRequest,
    response: PluginElicitationResponseRequest,
  ):
    | {
        ok: true;
        response: PluginElicitationResponse;
      }
    | Extract<PluginElicitationResolutionResult, { ok: false }> {
    if (
      !response ||
      (response.action !== "accept" &&
        response.action !== "decline" &&
        response.action !== "cancel")
    ) {
      return {
        ok: false,
        code: "INVALID_ELICITATION_RESPONSE",
        message: "Elicitation response action is invalid.",
      };
    }

    if (response.action !== "accept") {
      return { ok: true, response: { action: response.action } };
    }

    if (request.mode === "url") {
      return { ok: true, response: { action: "accept" } };
    }

    const content = response.content ?? {};
    const validation = this.validateElicitationContent(
      request.requestedSchema,
      content,
    );
    if (!validation.ok) {
      return validation;
    }

    return { ok: true, response: { action: "accept", content } };
  }

  private validateRequestedSchema(schema: ElicitationRequestedSchema): void {
    if (!schema || schema.type !== "object" || !schema.properties) {
      throw new Error(
        "Form elicitation requires an object requestedSchema with properties.",
      );
    }

    for (const [propertyName, propertySchema] of Object.entries(
      schema.properties,
    )) {
      if (!propertyName.trim()) {
        throw new Error("Elicitation schema property names cannot be empty.");
      }
      this.validatePropertySchema(propertyName, propertySchema);
    }
  }

  private validatePropertySchema(
    propertyName: string,
    schema: ElicitationPropertySchema,
  ): void {
    if (!schema || typeof schema !== "object") {
      throw new Error(`Invalid schema for property "${propertyName}".`);
    }

    if (schema.type === "string") {
      if (schema.pattern) {
        try {
          new RegExp(schema.pattern);
        } catch {
          throw new Error(
            `String elicitation property "${propertyName}" has an invalid pattern.`,
          );
        }
      }
      return;
    }

    if (
      schema.type === "number" ||
      schema.type === "integer" ||
      schema.type === "boolean"
    ) {
      return;
    }

    if (schema.type === "array") {
      if (
        !schema.items ||
        (!("enum" in schema.items) && !("anyOf" in schema.items))
      ) {
        throw new Error(
          `Array elicitation property "${propertyName}" must define enum options.`,
        );
      }
      return;
    }

    throw new Error(`Unsupported elicitation schema for "${propertyName}".`);
  }

  private validateElicitationContent(
    schema: ElicitationRequestedSchema,
    content: Record<string, unknown>,
  ): Extract<PluginElicitationResolutionResult, { ok: false }> | { ok: true } {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      return {
        ok: false,
        code: "INVALID_ELICITATION_RESPONSE",
        message: "Accepted elicitation content must be an object.",
      };
    }

    const required = new Set(schema.required ?? []);
    for (const name of required) {
      if (!(name in content) || content[name] === undefined) {
        return {
          ok: false,
          code: "INVALID_ELICITATION_RESPONSE",
          message: `Required elicitation field "${name}" is missing.`,
        };
      }
    }

    for (const [name, value] of Object.entries(content)) {
      const propertySchema = schema.properties[name];
      if (!propertySchema) {
        return {
          ok: false,
          code: "INVALID_ELICITATION_RESPONSE",
          message: `Unknown elicitation field "${name}".`,
        };
      }

      const fieldValidation = this.validateElicitationField(
        name,
        propertySchema,
        value,
      );
      if (!fieldValidation.ok) {
        return fieldValidation;
      }
    }

    return { ok: true };
  }

  private validateElicitationField(
    name: string,
    schema: ElicitationPropertySchema,
    value: unknown,
  ): Extract<PluginElicitationResolutionResult, { ok: false }> | { ok: true } {
    if (schema.type === "string") {
      if (typeof value !== "string") {
        return this.invalidField(name, "must be a string.");
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return this.invalidField(
          name,
          `must be at least ${schema.minLength} characters.`,
        );
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return this.invalidField(
          name,
          `must be at most ${schema.maxLength} characters.`,
        );
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        return this.invalidField(name, "does not match the required pattern.");
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return this.invalidField(name, "must be one of the allowed options.");
      }
      if (
        schema.oneOf &&
        !schema.oneOf.some((option) => option.const === value)
      ) {
        return this.invalidField(name, "must be one of the allowed options.");
      }
      if (schema.format && !this.matchesStringFormat(value, schema.format)) {
        return this.invalidField(name, `must be a valid ${schema.format}.`);
      }
      return { ok: true };
    }

    if (schema.type === "number" || schema.type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return this.invalidField(name, "must be a number.");
      }
      if (schema.type === "integer" && !Number.isInteger(value)) {
        return this.invalidField(name, "must be an integer.");
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        return this.invalidField(name, `must be at least ${schema.minimum}.`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return this.invalidField(name, `must be at most ${schema.maximum}.`);
      }
      return { ok: true };
    }

    if (schema.type === "boolean") {
      return typeof value === "boolean"
        ? { ok: true }
        : this.invalidField(name, "must be true or false.");
    }

    if (schema.type !== "array") {
      return this.invalidField(name, "uses an unsupported schema.");
    }

    if (!Array.isArray(value)) {
      return this.invalidField(name, "must be a list of strings.");
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return this.invalidField(
        name,
        `must include at least ${schema.minItems} selections.`,
      );
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return this.invalidField(
        name,
        `must include at most ${schema.maxItems} selections.`,
      );
    }

    const allowed = this.arraySchemaAllowedValues(schema);
    for (const item of value) {
      if (typeof item !== "string" || !allowed.has(item)) {
        return this.invalidField(name, "contains an unsupported option.");
      }
    }
    return { ok: true };
  }

  private invalidField(
    name: string,
    message: string,
  ): Extract<PluginElicitationResolutionResult, { ok: false }> {
    return {
      ok: false,
      code: "INVALID_ELICITATION_RESPONSE",
      message: `Elicitation field "${name}" ${message}`,
    };
  }

  private arraySchemaAllowedValues(
    schema: Extract<ElicitationPropertySchema, { type: "array" }>,
  ): Set<string> {
    if ("enum" in schema.items) {
      return new Set(schema.items.enum);
    }

    return new Set(schema.items.anyOf.map((option) => option.const));
  }

  private matchesStringFormat(
    value: string,
    format: NonNullable<
      Extract<ElicitationPropertySchema, { type: "string" }>["format"]
    >,
  ): boolean {
    if (format === "email") {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    if (format === "uri") {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }
    if (format === "date") {
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
      );
    }
    return !Number.isNaN(Date.parse(value));
  }
}
