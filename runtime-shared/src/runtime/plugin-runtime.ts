import type { SessionEvent } from "../contracts.js";
import type {
  PluginNotification,
  PluginNotificationInput,
  PluginEventInput,
  PluginRuntimeBinding,
  PluginRuntimeContext,
  PluginRuntimeEventInput,
  PluginRuntimeBindingIdentity,
  PluginRuntimeProvider,
} from "@mimir/agent-core/plugins";
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
        | "plugin_log";
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

    if (this.unreadCount() > 0) {
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
}
