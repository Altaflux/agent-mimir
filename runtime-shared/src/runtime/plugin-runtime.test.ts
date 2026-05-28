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
    await controller.forToolCall("timer", {
        taskId: "task-1",
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
