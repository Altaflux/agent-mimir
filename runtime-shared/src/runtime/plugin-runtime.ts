import type { SessionEvent } from "../contracts.js";
import type {
    PluginNotification,
    PluginNotificationInput,
    PluginRuntimeContext,
    PluginRuntimeEventInput,
    PluginRuntimeProvider
} from "@mimir/agent-core/plugins";
import type { ToolCallRuntimeContext, ToolCallRuntimeSource } from "@mimir/agent-core/tools";
import crypto from "crypto";

type SessionPluginRuntimeEvent = Extract<
    SessionEvent,
    { type: "plugin_event" | "plugin_notification" }
> extends infer T
    ? T extends unknown
        ? Omit<T, "id" | "sessionId" | "timestamp">
        : never
    : never;

export type SessionPluginRuntimeSink = {
    emitEvent(event: SessionPluginRuntimeEvent): void;
    emitStateChanged(): void;
};

export type SessionPluginRuntimePersistence = {
    saveNotification(notification: PluginNotification): void;
    deleteNotifications(notificationIds: string[]): void;
    clearNotifications(): void;
};

export type SessionPluginRuntimeAccessors = {
    persistence?: SessionPluginRuntimePersistence;
};

export class SessionPluginRuntimeController implements PluginRuntimeProvider {
    private sink: SessionPluginRuntimeSink | undefined;
    private bufferedEvents: SessionPluginRuntimeEvent[] = [];
    private notifications: PluginNotification[] = [];
    private persistedNotificationIds = new Set<string>();
    private accessors: SessionPluginRuntimeAccessors = {};

    constructor(
        private readonly agentName: string,
        initialNotifications: PluginNotification[] = []
    ) {
        this.notifications = [...initialNotifications];
        this.persistedNotificationIds = new Set(initialNotifications.map((notification) => notification.id));
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

    forPlugin(pluginName: string): PluginRuntimeContext {
        return {
            notifications: {
                enqueue: (input) => this.enqueueNotification(pluginName, input)
            }
        };
    }

    forToolCall(pluginName: string, source: ToolCallRuntimeSource): ToolCallRuntimeContext {
        return {
            ...source,
            emitEvent: (input) => this.emitToolCallEvent(pluginName, source, input)
        };
    }

    unreadCount(): number {
        return this.notifications.length;
    }

    listUnread(): PluginNotification[] {
        return [...this.notifications];
    }

    nextUnread(): PluginNotification | null {
        return this.notifications[0] ?? null;
    }

    remove(notificationIds: string[]): void {
        const ids = new Set(notificationIds);
        const previousCount = this.notifications.length;
        this.notifications = this.notifications.filter((notification) => !ids.has(notification.id));

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

    private emitToolCallEvent(pluginName: string, source: ToolCallRuntimeSource, input: PluginRuntimeEventInput): void {
        this.emitRuntimeEvent({
            type: "plugin_event",
            toolCallId: source.toolCallId,
            toolName: source.toolName,
            pluginName,
            agentName: this.agentName,
            visibility: input.visibility ?? "user",
            body: input.body
        });
    }

    private async enqueueNotification(pluginName: string, input: PluginNotificationInput): Promise<PluginNotification> {
        const deduplicationId = this.normalizeDeduplicationId(input.deduplicationId);
        if (deduplicationId) {
            const existingNotification = this.notifications.find(
                (notification) => notification.deduplicationId === deduplicationId
            );
            if (existingNotification) {
                return existingNotification;
            }
        }

        const notification: PluginNotification = {
            id: crypto.randomUUID(),
            pluginName,
            agentName: this.agentName,
            createdAt: Date.now(),
            title: input.title,
            summary: input.summary,
            deduplicationId,
            content: input.content
        };

        this.notifications.push(notification);
        this.persistNotification(notification);
        this.emitRuntimeEvent({
            type: "plugin_notification",
            notificationId: notification.id,
            pluginName,
            agentName: this.agentName,
            title: notification.title,
            summary: notification.summary,
            deduplicationId: notification.deduplicationId,
            unreadCount: this.unreadCount()
        });
        this.sink?.emitStateChanged();
        return notification;
    }

    private normalizeDeduplicationId(deduplicationId: string | undefined): string | undefined {
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

    private persistNotification(notification: PluginNotification): void {
        if (!this.accessors.persistence || this.persistedNotificationIds.has(notification.id)) {
            return;
        }

        this.accessors.persistence.saveNotification(notification);
        this.persistedNotificationIds.add(notification.id);
    }

    private emitRuntimeEvent(event: SessionPluginRuntimeEvent): void {
        if (!this.sink) {
            this.bufferedEvents.push(event);
            return;
        }

        this.sink.emitEvent(event);
    }
}
