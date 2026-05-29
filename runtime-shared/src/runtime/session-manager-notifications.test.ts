import assert from "node:assert/strict";
import test from "node:test";
import type { AgentInput, AgentNotificationInput } from "@mimir/agent-core/agent";
import type { PluginNotification } from "@mimir/agent-core/plugins";
import type { UserMessageOrigin } from "../contracts.js";
import { SessionManager } from "./session-manager.js";

type NotificationProcessingAccessor = {
    buildNotificationAgentInput(notification: PluginNotification): AgentInput;
    buildNotificationProcessingDisplayText(notification: AgentNotificationInput): string;
    buildNotificationMessageOrigin(notification: AgentNotificationInput): UserMessageOrigin;
    getHydratedInputPresentation(input: AgentInput): {
        origin: UserMessageOrigin;
        text: string;
        workspaceFiles: string[];
        chatImages: string[];
    };
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
    const input = manager.buildNotificationAgentInput(createNotification({ title: "Timer fired" }));
    assert.equal(input.type, "plugin_notification");

    assert.equal(
        manager.buildNotificationProcessingDisplayText(input.notification),
        "Process plugin notification: Timer fired"
    );
});

test("notification message origin exposes full notification metadata", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;
    const input = manager.buildNotificationAgentInput(createNotification());
    assert.equal(input.type, "plugin_notification");

    assert.deepEqual(manager.buildNotificationMessageOrigin(input.notification), {
        type: "plugin_notification",
        notificationId: "notification-1",
        pluginName: "runtime-smoke-test",
        title: "Worker complete",
        message: "Worker has a result."
    });
});

test("hydrated notification presentation is derived from first-class input", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;
    const input = manager.buildNotificationAgentInput(createNotification());

    assert.deepEqual(manager.getHydratedInputPresentation(input), {
        origin: {
            type: "plugin_notification",
            notificationId: "notification-1",
            pluginName: "runtime-smoke-test",
            title: "Worker complete",
            message: "Worker has a result."
        },
        text: "Process plugin notification: Worker complete",
        workspaceFiles: ["result.txt"],
        chatImages: []
    });
});
