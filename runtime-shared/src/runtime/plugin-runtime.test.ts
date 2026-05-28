import assert from "node:assert/strict";
import test from "node:test";
import { SessionPluginRuntimeController, type SessionPluginRuntimeSink } from "./plugin-runtime.js";

type RuntimeEventPayload = Parameters<SessionPluginRuntimeSink["emitEvent"]>[0];

function createSink() {
    const events: RuntimeEventPayload[] = [];
    let stateChangeCount = 0;

    return {
        events,
        get stateChangeCount() {
            return stateChangeCount;
        },
        sink: {
            emitEvent(event: RuntimeEventPayload) {
                events.push(event);
            },
            emitStateChanged() {
                stateChangeCount += 1;
            }
        }
    };
}

test("enqueue stores unread notifications and emits notification events", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    const sinkState = createSink();
    controller.attach(sinkState.sink);

    const notification = await controller.forPlugin("subagents").notifications.enqueue({
        title: "Worker complete",
        message: "Worker has a result.",
        content: {
            content: [{ type: "text", text: "result body" }]
        }
    });

    assert.equal(notification.pluginName, "subagents");
    assert.equal(notification.agentName, "Principal");
    assert.equal(notification.read, false);
    assert.equal(controller.unreadCount(), 1);
    assert.equal(sinkState.stateChangeCount, 1);
    assert.equal(sinkState.events.length, 1);
    assert.deepEqual(sinkState.events[0], {
        type: "plugin_notification",
        notificationId: notification.id,
        pluginName: "subagents",
        agentName: "Principal",
        title: "Worker complete",
        message: "Worker has a result.",
        unreadCount: 1
    });
});

test("tool call runtime events emitted before attach are buffered and flushed", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    controller.configure({
        getCurrentTaskId: () => "task-1",
        getNotificationAnchorTaskId: () => null
    });
    await controller.forToolCall("timer", {
        toolCallId: "tool-call-1",
        toolName: "timer_tool"
    }).emitEvent({
        body: {
            type: "status",
            message: "Timer fired"
        }
    });

    const { events, sink } = createSink();
    controller.attach(sink);

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
        type: "plugin_event",
        taskId: "task-1",
        toolCallId: "tool-call-1",
        toolName: "timer_tool",
        pluginName: "timer",
        agentName: "Principal",
        visibility: "user",
        body: {
            type: "status",
            message: "Timer fired"
        }
    });
});

test("markRead clears unread counts without losing historical notifications", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    const sinkState = createSink();
    controller.attach(sinkState.sink);

    const notification = await controller.forPlugin("subagents").notifications.enqueue({
        title: "Done",
        content: {
            content: [{ type: "text", text: "done" }]
        }
    });

    controller.markRead([notification.id]);

    assert.equal(controller.unreadCount(), 0);
    assert.equal(controller.listUnread().length, 0);
    assert.equal(sinkState.stateChangeCount, 2);
});

test("nextUnread returns one notification at a time in inbox order", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    const first = await controller.forPlugin("subagents").notifications.enqueue({
        title: "First",
        content: {
            content: [{ type: "text", text: "first" }]
        }
    });
    const second = await controller.forPlugin("timer").notifications.enqueue({
        title: "Second",
        content: {
            content: [{ type: "text", text: "second" }]
        }
    });

    assert.equal(controller.nextUnread()?.id, first.id);

    controller.markRead([first.id]);

    assert.equal(controller.nextUnread()?.id, second.id);
    assert.equal(controller.unreadCount(), 1);
});

test("nextUnread returns null when there are no unread notifications", () => {
    const controller = new SessionPluginRuntimeController("Principal");

    assert.equal(controller.nextUnread(), null);
});

test("notifications enqueued before persistence is configured are saved with the runtime anchor", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    const notification = await controller.forPlugin("subagents").notifications.enqueue({
        title: "Early notification",
        content: {
            content: [{ type: "text", text: "ready" }]
        }
    });
    const saved: Array<{ id: string; anchorTaskId: string | null }> = [];

    controller.configure({
        getCurrentTaskId: () => "task-1",
        getNotificationAnchorTaskId: () => "root-message-1",
        persistence: {
            saveNotification(persistedNotification, anchorTaskId) {
                saved.push({ id: persistedNotification.id, anchorTaskId });
            },
            markNotificationsRead() {
                return;
            },
            clearNotifications() {
                return;
            }
        }
    });

    assert.deepEqual(saved, [{ id: notification.id, anchorTaskId: "root-message-1" }]);
});

test("markRead persists read state with an epoch timestamp", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    let readCall: { ids: string[]; readAt: number } | undefined;
    controller.configure({
        getCurrentTaskId: () => "task-1",
        getNotificationAnchorTaskId: () => null,
        persistence: {
            saveNotification() {
                return;
            },
            markNotificationsRead(notificationIds, readAt) {
                readCall = { ids: notificationIds, readAt };
            },
            clearNotifications() {
                return;
            }
        }
    });

    const notification = await controller.forPlugin("subagents").notifications.enqueue({
        title: "Done",
        content: {
            content: [{ type: "text", text: "done" }]
        }
    });

    controller.markRead([notification.id]);

    assert.deepEqual(readCall?.ids, [notification.id]);
    assert.equal(typeof readCall?.readAt, "number");
    assert.ok((readCall?.readAt ?? 0) > 0);
});
