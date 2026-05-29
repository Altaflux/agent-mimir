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
        summary: "Worker has a result.",
        content: {
            content: [{ type: "text", text: "result body" }]
        }
    });

    assert.equal(notification.pluginName, "subagents");
    assert.equal(notification.agentName, "Principal");
    assert.equal(controller.unreadCount(), 1);
    assert.equal(sinkState.stateChangeCount, 1);
    assert.equal(sinkState.events.length, 1);
    assert.deepEqual(sinkState.events[0], {
        type: "plugin_notification",
        notificationId: notification.id,
        pluginName: "subagents",
        agentName: "Principal",
        title: "Worker complete",
        summary: "Worker has a result.",
        deduplicationId: undefined,
        unreadCount: 1
    });
});

test("tool call runtime events emitted before attach are buffered and flushed", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
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

test("remove clears pending notifications", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    const sinkState = createSink();
    controller.attach(sinkState.sink);

    const notification = await controller.forPlugin("subagents").notifications.enqueue({
        title: "Done",
        content: {
            content: [{ type: "text", text: "done" }]
        }
    });

    controller.remove([notification.id]);

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

    controller.remove([first.id]);

    assert.equal(controller.nextUnread()?.id, second.id);
    assert.equal(controller.unreadCount(), 1);
});

test("enqueue discards duplicate pending notifications by deduplication id", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    const sinkState = createSink();
    controller.attach(sinkState.sink);

    const first = await controller.forPlugin("subagents").notifications.enqueue({
        title: "First",
        deduplicationId: "worker-1",
        content: {
            content: [{ type: "text", text: "first" }]
        }
    });
    const duplicate = await controller.forPlugin("subagents").notifications.enqueue({
        title: "Duplicate",
        deduplicationId: "worker-1",
        content: {
            content: [{ type: "text", text: "duplicate" }]
        }
    });

    assert.equal(duplicate.id, first.id);
    assert.equal(controller.unreadCount(), 1);
    assert.equal(controller.nextUnread()?.title, "First");
    assert.equal(sinkState.events.length, 1);
    assert.equal(sinkState.stateChangeCount, 1);
});

test("deduplication ids can be reused after pending notification removal", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    const first = await controller.forPlugin("subagents").notifications.enqueue({
        title: "First",
        deduplicationId: "worker-1",
        content: {
            content: [{ type: "text", text: "first" }]
        }
    });
    controller.remove([first.id]);

    const next = await controller.forPlugin("subagents").notifications.enqueue({
        title: "Next",
        deduplicationId: "worker-1",
        content: {
            content: [{ type: "text", text: "next" }]
        }
    });

    assert.notEqual(next.id, first.id);
    assert.equal(controller.unreadCount(), 1);
    assert.equal(controller.nextUnread()?.title, "Next");
});

test("nextUnread returns null when there are no unread notifications", () => {
    const controller = new SessionPluginRuntimeController("Principal");

    assert.equal(controller.nextUnread(), null);
});

test("notifications enqueued before persistence is configured are saved as pending notifications", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    const notification = await controller.forPlugin("subagents").notifications.enqueue({
        title: "Early notification",
        content: {
            content: [{ type: "text", text: "ready" }]
        }
    });
    const saved: string[] = [];

    controller.configure({
        persistence: {
            saveNotification(persistedNotification) {
                saved.push(persistedNotification.id);
            },
            deleteNotifications() {
                return;
            },
            clearNotifications() {
                return;
            }
        }
    });

    assert.deepEqual(saved, [notification.id]);
});

test("remove deletes pending notification persistence rows", async () => {
    const controller = new SessionPluginRuntimeController("Principal");
    let deletedIds: string[] | undefined;
    controller.configure({
        persistence: {
            saveNotification() {
                return;
            },
            deleteNotifications(notificationIds) {
                deletedIds = notificationIds;
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

    controller.remove([notification.id]);

    assert.deepEqual(deletedIds, [notification.id]);
});
