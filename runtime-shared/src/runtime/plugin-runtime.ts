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

export class SessionPluginRuntimeController implements PluginRuntimeProvider {
    private sink: SessionPluginRuntimeSink | undefined;
    private bufferedEvents: SessionPluginRuntimeEvent[] = [];
    private notifications: PluginNotification[] = [];

    constructor(
        private readonly agentName: string
    ) {
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
        return this.notifications.filter((notification) => !notification.read).length;
    }

    listUnread(): PluginNotification[] {
        return this.notifications.filter((notification) => !notification.read);
    }

    markRead(notificationIds: string[]): void {
        const ids = new Set(notificationIds);
        let changed = false;
        for (const notification of this.notifications) {
            if (!notification.read && ids.has(notification.id)) {
                notification.read = true;
                changed = true;
            }
        }

        if (changed) {
            this.sink?.emitStateChanged();
        }
    }

    clearNotifications(): void {
        if (this.notifications.length === 0) {
            return;
        }

        this.notifications = [];
        this.sink?.emitStateChanged();
    }

    private emitToolCallEvent(pluginName: string, source: ToolCallRuntimeSource, input: PluginRuntimeEventInput): void {
        this.emitRuntimeEvent({
            type: "plugin_event",
            taskId: source.taskId,
            toolCallId: source.toolCallId,
            toolName: source.toolName,
            pluginName,
            agentName: this.agentName,
            visibility: input.visibility ?? "user",
            body: input.body
        });
    }

    private async enqueueNotification(pluginName: string, input: PluginNotificationInput): Promise<PluginNotification> {
        const notification: PluginNotification = {
            id: crypto.randomUUID(),
            pluginName,
            agentName: this.agentName,
            createdAt: Date.now(),
            title: input.title,
            message: input.message,
            content: input.content,
            read: false
        };

        this.notifications.push(notification);
        this.emitRuntimeEvent({
            type: "plugin_notification",
            notificationId: notification.id,
            pluginName,
            agentName: this.agentName,
            title: notification.title,
            message: notification.message,
            unreadCount: this.unreadCount()
        });
        this.sink?.emitStateChanged();
        return notification;
    }

    private emitRuntimeEvent(event: SessionPluginRuntimeEvent): void {
        if (!this.sink) {
            this.bufferedEvents.push(event);
            return;
        }

        this.sink.emitEvent(event);
    }
}
