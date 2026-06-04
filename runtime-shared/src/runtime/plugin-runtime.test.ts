import assert from "node:assert/strict";
import test from "node:test";
import { SessionPluginRuntimeController, type SessionPluginRuntimeSink } from "./plugin-runtime.js";
import { DiskPluginStateStore } from "./plugin-state-store.js";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

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

async function withTempStateStore<T>(run: (store: DiskPluginStateStore, directory: string) => Promise<T>): Promise<T> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mimir-plugin-state-"));
    const store = new DiskPluginStateStore(directory);
    await store.clear();
    try {
        return await run(store, directory);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
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

test("plugin STATE writes disk state and emits summary events", async () => {
    await withTempStateStore(async (stateStore) => {
        const controller = new SessionPluginRuntimeController("Principal");
        const sinkState = createSink();
        controller.configure({ stateStore });
        controller.attach(sinkState.sink);

        await controller.forPlugin("browser").events.emit({
            type: "STATE",
            markdown: "# Browser\n\n![Current page](asset://screenshot)",
            assets: [
                {
                    id: "screenshot",
                    fileName: "page.png",
                    contentType: "image/png",
                    bytes: Buffer.from("image-bytes")
                }
            ]
        });

        assert.equal(sinkState.events.length, 1);
        assert.equal(sinkState.events[0]?.type, "plugin_state");
        assert.equal(sinkState.events[0]?.pluginName, "browser");

        const states = await controller.listPluginStates();
        assert.equal(states.length, 1);
        assert.equal(states[0]?.pluginName, "browser");

        const detail = await controller.readPluginState("browser");
        assert.equal(detail?.markdown, "# Browser\n\n![Current page](asset://screenshot)");

        const asset = await controller.resolvePluginStateAsset("browser", states[0]!.revision, "screenshot");
        assert.equal(asset?.fileName, "page.png");
        assert.equal(asset?.contentType, "image/png");
        assert.equal(await fs.readFile(asset!.absolutePath, "utf8"), "image-bytes");
    });
});

test("plugin STATE replaces previous state and assets", async () => {
    await withTempStateStore(async (stateStore) => {
        const controller = new SessionPluginRuntimeController("Principal");
        controller.configure({ stateStore });

        await controller.forPlugin("tasks").events.emit({
            type: "STATE",
            markdown: "first",
            assets: [{ id: "first", bytes: Buffer.from("first") }]
        });
        const first = (await controller.listPluginStates())[0]!;

        await controller.forPlugin("tasks").events.emit({
            type: "STATE",
            markdown: "second",
            assets: [{ id: "second", bytes: Buffer.from("second") }]
        });
        const second = (await controller.listPluginStates())[0]!;

        assert.notEqual(second.revision, first.revision);
        assert.equal((await controller.readPluginState("tasks"))?.markdown, "second");
        assert.equal(await controller.resolvePluginStateAsset("tasks", first.revision, "first"), null);
        assert.equal((await controller.resolvePluginStateAsset("tasks", second.revision, "second"))?.fileName, "second");
    });
});

test("plugin LOG emits live only and is not buffered", async () => {
    const controller = new SessionPluginRuntimeController("Principal");

    await controller.forPlugin("logger").events.emit({
        type: "LOG",
        text: "before attach"
    });

    const sinkState = createSink();
    controller.attach(sinkState.sink);
    assert.equal(sinkState.events.length, 0);

    await controller.forPlugin("logger").events.emit({
        type: "LOG",
        text: "after attach"
    });

    assert.deepEqual(sinkState.events, [
        {
            type: "plugin_log",
            pluginName: "logger",
            agentName: "Principal",
            text: "after attach"
        }
    ]);
});

test("clearPluginStates removes disk state", async () => {
    await withTempStateStore(async (stateStore) => {
        const controller = new SessionPluginRuntimeController("Principal");
        controller.configure({ stateStore });

        await controller.forPlugin("tasks").events.emit({
            type: "STATE",
            markdown: "pending"
        });
        assert.equal((await controller.listPluginStates()).length, 1);

        await controller.clearPluginStates();

        assert.equal((await controller.listPluginStates()).length, 0);
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
