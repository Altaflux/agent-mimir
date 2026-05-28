import assert from "node:assert/strict";
import test from "node:test";
import type { PluginNotification } from "@mimir/agent-core/plugins";
import { extractAllTextFromComplexResponse } from "@mimir/agent-core/utils/format";
import { SessionManager } from "./session-manager.js";

type NotificationProcessingAccessor = {
    buildNotificationProcessingMessage(notification: PluginNotification): {
        content: PluginNotification["content"]["content"];
        sharedFiles?: PluginNotification["content"]["sharedFiles"];
    };
    buildNotificationProcessingDisplayText(notification: PluginNotification): string;
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

test("notification processing message is focused on one notification", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;
    const notification = createNotification();

    const message = manager.buildNotificationProcessingMessage(notification);
    const text = extractAllTextFromComplexResponse(message.content);

    assert.match(text, /process this pending plugin notification/i);
    assert.match(text, /Plugin: runtime-smoke-test/);
    assert.match(text, /Title: Worker complete/);
    assert.match(text, /result body/);
    assert.doesNotMatch(text, /Notification 2/);
    assert.deepEqual(message.sharedFiles, [{ fileName: "result.txt", url: "/tmp/result.txt" }]);
});

test("notification processing display text names the single notification", () => {
    const manager = new SessionManager({ cleanupIntervalMs: 60_000 }) as unknown as NotificationProcessingAccessor;

    assert.equal(
        manager.buildNotificationProcessingDisplayText(createNotification({ title: "Timer fired" })),
        "Process plugin notification: Timer fired"
    );
});
