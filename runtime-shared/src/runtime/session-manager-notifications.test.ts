import assert from "node:assert/strict";
import test from "node:test";
import type { AgentInput } from "@mimir/agent-core/agent";
import type { PluginNotification } from "@mimir/agent-core/plugins";
import type { UserMessageOrigin } from "../contracts.js";
import { SessionManager } from "./session-manager.js";

type NotificationProcessingAccessor = {
    buildNotificationAgentInput(notification: PluginNotification): AgentInput;
    buildNotificationProcessingDisplayText(notification: PluginNotification): string;
    buildNotificationMessageOrigin(notification: PluginNotification): UserMessageOrigin;
    getHydratedMessageOrigin(requestAttributes: Record<string, unknown>): UserMessageOrigin;
};

function createNotification(overrides: Partial<PluginNotification> = {}): PluginNotification {
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

test("notification processing passes one first-class notification input", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;
    const notification = createNotification();

    assert.deepEqual(manager.buildNotificationAgentInput(notification), {
        type: "plugin_notification",
        notification: {
            notificationId: "notification-1",
            pluginName: "runtime-smoke-test",
            title: "Worker complete",
            message: "Worker has a result.",
            content: notification.content
        }
    });
});

test("notification processing display text names the single notification", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;

    assert.equal(
        manager.buildNotificationProcessingDisplayText(createNotification({ title: "Timer fired" })),
        "Process plugin notification: Timer fired"
    );
});

test("notification message origin exposes full notification metadata", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;

    assert.deepEqual(manager.buildNotificationMessageOrigin(createNotification()), {
        type: "plugin_notification",
        notificationId: "notification-1",
        pluginName: "runtime-smoke-test",
        title: "Worker complete",
        message: "Worker has a result."
    });
});

test("hydrated notification message origin is restored from request attributes", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;

    assert.deepEqual(
        manager.getHydratedMessageOrigin({
            runtimeMessageOrigin: {
                type: "plugin_notification",
                notificationId: "notification-1",
                pluginName: "runtime-smoke-test",
                title: "Worker complete",
                message: "Worker has a result."
            }
        }),
        {
            type: "plugin_notification",
            notificationId: "notification-1",
            pluginName: "runtime-smoke-test",
            title: "Worker complete",
            message: "Worker has a result."
        }
    );

    assert.deepEqual(
        manager.getHydratedMessageOrigin({
            mimirMessageOrigin: {
                type: "plugin_notification",
                notificationId: "old-notification",
                pluginName: "legacy-plugin",
                title: "Legacy notification"
            }
        }),
        {
            type: "plugin_notification",
            notificationId: "old-notification",
            pluginName: "legacy-plugin",
            title: "Legacy notification",
            message: undefined
        }
    );
});

test("hydrated message origin falls back to user when missing or malformed", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;

    assert.deepEqual(manager.getHydratedMessageOrigin({}), { type: "user" });
    assert.deepEqual(
        manager.getHydratedMessageOrigin({
            runtimeMessageOrigin: {
                type: "plugin_notification",
                pluginName: "runtime-smoke-test"
            }
        }),
        { type: "user" }
    );
});
