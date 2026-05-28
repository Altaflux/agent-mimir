import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PluginNotification } from "@mimir/agent-core/plugins";
import type { SessionEvent } from "../contracts.js";
import { SessionStore } from "./session-store.js";

async function withStore(callback: (store: SessionStore) => void | Promise<void>): Promise<void> {
    const directory = await mkdtemp(path.join(tmpdir(), "mimir-session-store-test-"));
    const store = new SessionStore();
    await store.init(directory);

    try {
        await callback(store);
    } finally {
        store.close();
        await rm(directory, { recursive: true, force: true });
    }
}

function pluginEvent(overrides: Partial<Extract<SessionEvent, { type: "plugin_event" }>> = {}): Extract<SessionEvent, { type: "plugin_event" }> {
    return {
        id: "plugin-event-1",
        sessionId: "session-1",
        timestamp: "2026-05-28T10:00:00.000Z",
        type: "plugin_event",
        taskId: "root-message-1",
        toolCallId: "tool-call-1",
        toolName: "runtime_smoke",
        pluginName: "runtime-smoke-test",
        agentName: "Principal",
        visibility: "user",
        body: {
            type: "status",
            message: "Tool started"
        },
        ...overrides
    };
}

function pluginNotificationEvent(
    overrides: Partial<Extract<SessionEvent, { type: "plugin_notification" }>> = {}
): Extract<SessionEvent, { type: "plugin_notification" }> {
    return {
        id: "plugin-notification-event-1",
        sessionId: "session-1",
        timestamp: "2026-05-28T10:01:00.000Z",
        type: "plugin_notification",
        notificationId: "notification-1",
        pluginName: "runtime-smoke-test",
        agentName: "Principal",
        title: "Worker complete",
        message: "Worker has a result.",
        unreadCount: 1,
        ...overrides
    };
}

function notification(overrides: Partial<PluginNotification> = {}): PluginNotification {
    return {
        id: "notification-1",
        pluginName: "runtime-smoke-test",
        agentName: "Principal",
        createdAt: 1779962460000,
        title: "Worker complete",
        message: "Worker has a result.",
        content: {
            content: [{ type: "text", text: "result body" }],
            sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }]
        },
        read: false,
        ...overrides
    };
}

test("plugin runtime events persist with task and tool origin", async () => {
    await withStore((store) => {
        const event = pluginEvent();

        store.appendPluginRuntimeEvent("session-1", event, {
            anchorTaskId: null,
            retentionLimit: 10
        });

        const storedEvents = store.listPluginRuntimeEvents("session-1");
        assert.equal(storedEvents.length, 1);
        assert.equal(storedEvents[0]?.anchorTaskId, null);
        assert.deepEqual(storedEvents[0]?.event, event);
        assert.ok((storedEvents[0]?.sequence ?? 0) > 0);
    });
});

test("plugin notification events persist with their runtime-owned anchor", async () => {
    await withStore((store) => {
        const event = pluginNotificationEvent();

        store.appendPluginRuntimeEvent("session-1", event, {
            anchorTaskId: "root-message-1",
            retentionLimit: 10
        });

        const storedEvents = store.listPluginRuntimeEvents("session-1");
        assert.equal(storedEvents.length, 1);
        assert.equal(storedEvents[0]?.anchorTaskId, "root-message-1");
        assert.deepEqual(storedEvents[0]?.event, event);
    });
});

test("plugin notifications persist epoch createdAt, read state, content, and anchor", async () => {
    await withStore((store) => {
        const unread = notification();

        store.savePluginNotification("session-1", unread, "root-message-1");
        let storedNotifications = store.listPluginNotifications("session-1");

        assert.equal(storedNotifications.length, 1);
        assert.equal(storedNotifications[0]?.anchorTaskId, "root-message-1");
        assert.equal(storedNotifications[0]?.readAt, null);
        assert.equal(storedNotifications[0]?.notification.createdAt, 1779962460000);
        assert.equal(storedNotifications[0]?.notification.read, false);
        assert.deepEqual(storedNotifications[0]?.notification.content, unread.content);

        store.markPluginNotificationsRead("session-1", [unread.id], 1779962500000);
        storedNotifications = store.listPluginNotifications("session-1");

        assert.equal(storedNotifications[0]?.notification.read, true);
        assert.equal(storedNotifications[0]?.readAt, 1779962500000);
    });
});

test("plugin persistence contributes to discovery activity and clears on delete", async () => {
    await withStore((store) => {
        store.upsertName("session-1", "Plugin session");
        store.appendPluginRuntimeEvent("session-1", pluginEvent(), {
            anchorTaskId: null,
            retentionLimit: 10
        });
        store.savePluginNotification("session-1", notification(), null);

        const activity = store.getPluginSessionActivity().get("session-1");
        assert.ok(activity);
        assert.equal(activity.earliestTimestampMs, Date.parse("2026-05-28T10:00:00.000Z"));
        assert.equal(activity.latestTimestampMs, 1779962460000);

        store.deleteSession("session-1");

        assert.equal(store.listPluginRuntimeEvents("session-1").length, 0);
        assert.equal(store.listPluginNotifications("session-1").length, 0);
        assert.equal(store.getName("session-1"), null);
    });
});
