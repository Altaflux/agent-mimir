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
        summary: "Worker has a result.",
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
        summary: "Worker has a result.",
        content: {
            content: [{ type: "text", text: "result body" }],
            sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }]
        },
        ...overrides
    };
}

test("plugin runtime events persist with tool origin", async () => {
    await withStore((store) => {
        const event = pluginEvent();

        store.appendPluginRuntimeEvent("session-1", event, { retentionLimit: 10 });

        const storedEvents = store.listPluginRuntimeEvents("session-1");
        assert.equal(storedEvents.length, 1);
        assert.deepEqual(storedEvents[0]?.event, event);
        assert.ok((storedEvents[0]?.sequence ?? 0) > 0);
    });
});

test("plugin notification events persist without notification anchors", async () => {
    await withStore((store) => {
        const event = pluginNotificationEvent();

        store.appendPluginRuntimeEvent("session-1", event, { retentionLimit: 10 });

        const storedEvents = store.listPluginRuntimeEvents("session-1");
        assert.equal(storedEvents.length, 1);
        assert.deepEqual(storedEvents[0]?.event, event);
    });
});

test("plugin notifications persist pending notification content in creation order", async () => {
    await withStore((store) => {
        const later = notification({ id: "notification-2", createdAt: 1779962470000, title: "Later" });
        const earlier = notification({ id: "notification-1", createdAt: 1779962460000, title: "Earlier" });

        store.savePluginNotification("session-1", later);
        store.savePluginNotification("session-1", earlier);
        let storedNotifications = store.listPluginNotifications("session-1");

        assert.equal(storedNotifications.length, 2);
        assert.equal(storedNotifications[0]?.notification.id, "notification-1");
        assert.equal(storedNotifications[1]?.notification.id, "notification-2");
        assert.equal(storedNotifications[0]?.notification.createdAt, 1779962460000);
        assert.deepEqual(storedNotifications[0]?.notification.content, earlier.content);

        store.deletePluginNotifications("session-1", [earlier.id]);
        storedNotifications = store.listPluginNotifications("session-1");

        assert.equal(storedNotifications.length, 1);
        assert.equal(storedNotifications[0]?.notification.id, "notification-2");
    });
});

test("plugin persistence contributes to discovery activity and clears on delete", async () => {
    await withStore((store) => {
        store.upsertName("session-1", "Plugin session");
        store.appendPluginRuntimeEvent("session-1", pluginEvent(), { retentionLimit: 10 });
        store.savePluginNotification("session-1", notification());

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
