import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { SessionEvent } from "../contracts.js";
import { SessionStore } from "./session-store.js";
import type { RuntimePluginNotification } from "./plugin-runtime.js";

async function withStore(
    callback: (store: SessionStore) => void | Promise<void>,
): Promise<void> {
    const directory = await mkdtemp(
        path.join(tmpdir(), "mimir-session-store-test-"),
    );
    const store = new SessionStore();
    await store.init(directory);

    try {
        await callback(store);
    } finally {
        store.close();
        await rm(directory, { recursive: true, force: true });
    }
}

function pluginEvent(
    overrides: Partial<Extract<SessionEvent, { type: "plugin_event" }>> = {},
): Extract<SessionEvent, { type: "plugin_event" }> {
    return {
        id: "plugin-event-1",
        sessionId: "session-1",
        timestamp: "2026-05-28T10:00:00.000Z",
        type: "plugin_event",
        toolCallId: "tool-call-1",
        toolName: "runtime_smoke",
        pluginInstanceId: "plugin-instance-1",
        pluginName: "runtime-smoke-test",
        agentName: "Principal",
        visibility: "user",
        body: {
            type: "status",
            message: "Tool started",
        },
        ...overrides,
    };
}

function pluginNotificationEvent(
    overrides: Partial<
        Extract<SessionEvent, { type: "plugin_notification" }>
    > = {},
): Extract<SessionEvent, { type: "plugin_notification" }> {
    return {
        id: "plugin-notification-event-1",
        sessionId: "session-1",
        timestamp: "2026-05-28T10:01:00.000Z",
        type: "plugin_notification",
        notificationId: "notification-1",
        pluginInstanceId: "plugin-instance-1",
        pluginName: "runtime-smoke-test",
        agentName: "Principal",
        title: "Worker complete",
        summary: "Worker has a result.",
        unreadCount: 1,
        ...overrides,
    };
}

function notification(
    overrides: Partial<RuntimePluginNotification> = {},
): RuntimePluginNotification {
    return {
        id: "notification-1",
        pluginInstanceId: "plugin-instance-1",
        pluginName: "runtime-smoke-test",
        agentName: "Principal",
        createdAt: 1779962460000,
        title: "Worker complete",
        summary: "Worker has a result.",
        deduplicationId: "worker-complete",
        content: {
            content: [{ type: "text", text: "result body" }],
            sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }],
        },
        ...overrides,
    };
}

test("plugin runtime events persist with tool origin", async () => {
    await withStore((store) => {
        const event = pluginEvent();

        store.appendPluginRuntimeEvent("session-1", event, {
            retentionLimit: 10,
        });

        const storedEvents = store.listPluginRuntimeEvents("session-1");
        assert.equal(storedEvents.length, 1);
        assert.deepEqual(storedEvents[0]?.event, event);
        assert.ok((storedEvents[0]?.sequence ?? 0) > 0);
    });
});

test("plugin notification events persist without notification anchors", async () => {
    await withStore((store) => {
        const event = pluginNotificationEvent();

        store.appendPluginRuntimeEvent("session-1", event, {
            retentionLimit: 10,
        });

        const storedEvents = store.listPluginRuntimeEvents("session-1");
        assert.equal(storedEvents.length, 1);
        assert.deepEqual(storedEvents[0]?.event, event);
    });
});

test("plugin notifications persist pending notification content in creation order", async () => {
    await withStore((store) => {
        const later = notification({
            id: "notification-2",
            createdAt: 1779962470000,
            title: "Later",
        });
        const earlier = notification({
            id: "notification-1",
            createdAt: 1779962460000,
            title: "Earlier",
        });

        store.savePluginNotification("session-1", later);
        store.savePluginNotification("session-1", earlier);
        let storedNotifications = store.listPluginNotifications("session-1");

        assert.equal(storedNotifications.length, 2);
        assert.equal(storedNotifications[0]?.notification.id, "notification-1");
        assert.equal(storedNotifications[1]?.notification.id, "notification-2");
        assert.equal(
            storedNotifications[0]?.notification.createdAt,
            1779962460000,
        );
        assert.equal(
            storedNotifications[0]?.notification.pluginInstanceId,
            "plugin-instance-1",
        );
        assert.equal(
            storedNotifications[0]?.notification.deduplicationId,
            "worker-complete",
        );
        assert.deepEqual(
            storedNotifications[0]?.notification.content,
            earlier.content,
        );

        store.deletePluginNotifications("session-1", [earlier.id]);
        storedNotifications = store.listPluginNotifications("session-1");

        assert.equal(storedNotifications.length, 1);
        assert.equal(storedNotifications[0]?.notification.id, "notification-2");
    });
});

test("session catalog stores and orders session summaries", async () => {
    await withStore((store) => {
        store.upsertSession({
            sessionId: "session-1",
            name: "First session",
            createdAtMs: 1000,
            lastActivityAtMs: 2000,
            agentName: "Principal",
            continuousMode: false,
        });
        store.upsertSession({
            sessionId: "session-2",
            name: "Second session",
            createdAtMs: 1500,
            lastActivityAtMs: 3000,
            agentName: "Assistant",
            continuousMode: true,
        });
        store.updateSessionActivity("session-1", 4000);
        store.updateSessionContinuousMode("session-1", true);

        const sessions = store.listSessions();

        assert.equal(sessions.length, 2);
        assert.deepEqual(sessions[0], {
            sessionId: "session-1",
            name: "First session",
            createdAtMs: 1000,
            lastActivityAtMs: 4000,
            agentName: "Principal",
            continuousMode: true,
        });
        assert.deepEqual(sessions[1], {
            sessionId: "session-2",
            name: "Second session",
            createdAtMs: 1500,
            lastActivityAtMs: 3000,
            agentName: "Assistant",
            continuousMode: true,
        });
        assert.deepEqual(store.getSession("session-2"), sessions[1]);
    });
});

test("deleteSession clears catalog and plugin metadata", async () => {
    await withStore((store) => {
        store.upsertSession({
            sessionId: "session-1",
            name: "Plugin session",
            createdAtMs: Date.parse("2026-05-28T10:00:00.000Z"),
            lastActivityAtMs: 1779962460000,
            agentName: "Principal",
            continuousMode: false,
        });
        store.appendPluginRuntimeEvent("session-1", pluginEvent(), {
            retentionLimit: 10,
        });
        store.savePluginNotification("session-1", notification());

        store.deleteSession("session-1");

        assert.equal(store.listPluginRuntimeEvents("session-1").length, 0);
        assert.equal(store.listPluginNotifications("session-1").length, 0);
        assert.equal(store.getSession("session-1"), null);
    });
});
