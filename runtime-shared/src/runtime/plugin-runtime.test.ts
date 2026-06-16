import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionPluginRuntimeController,
  type SessionPluginRuntimeSink,
} from "./plugin-runtime.js";
import { DiskPluginStateStore } from "./plugin-state-store.js";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

type RuntimeEventPayload = Parameters<SessionPluginRuntimeSink["emitEvent"]>[0];

function requireEvent<T extends RuntimeEventPayload["type"]>(
  event: RuntimeEventPayload | undefined,
  type: T,
): Extract<RuntimeEventPayload, { type: T }> {
  assert.equal(event?.type, type);
  return event as Extract<RuntimeEventPayload, { type: T }>;
}

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
      },
    },
  };
}

function pluginIdentity(pluginId: string, pluginPrefix?: string) {
  return {
    pluginId,
    pluginPrefix,
    pluginNamespace: pluginPrefix ? `${pluginPrefix}__${pluginId}` : pluginId,
  };
}

test("plugin runtime exposes elicitation at plugin level only", () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const binding = controller.bindPlugin(pluginIdentity("profile"));

  assert.equal(typeof binding.runtime.elicitation.create, "function");
  assert.equal(typeof binding.runtime.elicitation.complete, "function");
  const toolRuntime = binding.toolRuntime.forToolCall({
    toolCallId: "tool-call-1",
    toolName: "profile__lookup",
  });
  assert.equal(
    "elicitation" in toolRuntime,
    false,
  );
});

async function withTempStateStore<T>(
  run: (store: DiskPluginStateStore, directory: string) => Promise<T>,
): Promise<T> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "mimir-plugin-state-"),
  );
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
  const binding = controller.bindPlugin(pluginIdentity("subagents"));

  const notification = await binding.runtime.notifications.enqueue({
    title: "Worker complete",
    summary: "Worker has a result.",
    content: {
      content: [{ type: "text", text: "result body" }],
    },
  });

  assert.equal(notification.pluginId, "subagents");
  assert.equal(notification.pluginPrefix, undefined);
  assert.equal(notification.pluginNamespace, "subagents");
  assert.equal(notification.agentName, "Principal");
  assert.equal("pluginInstanceId" in notification, false);
  assert.equal(controller.unreadCount(), 1);
  assert.equal(sinkState.stateChangeCount, 1);
  assert.equal(sinkState.events.length, 1);
  const notificationEvent = requireEvent(
    sinkState.events[0],
    "plugin_notification",
  );
  const pluginInstanceId = notificationEvent.pluginInstanceId;
  assert.match(pluginInstanceId ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(sinkState.events[0], {
    type: "plugin_notification",
    notificationId: notification.id,
    pluginInstanceId,
    pluginId: "subagents",
    pluginPrefix: undefined,
    pluginNamespace: "subagents",
    agentName: "Principal",
    title: "Worker complete",
    summary: "Worker has a result.",
    deduplicationId: undefined,
    unreadCount: 1,
  });
});

test("tool call runtime events emitted before attach are buffered and flushed", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const binding = controller.bindPlugin(pluginIdentity("timer"));
  await binding.toolRuntime
    .forToolCall({
      toolCallId: "tool-call-1",
      toolName: "timer_tool",
    })
    .emitEvent({
      body: {
        type: "status",
        message: "Timer fired",
      },
    });

  const { events, sink } = createSink();
  controller.attach(sink);

  assert.equal(events.length, 1);
  const event = requireEvent(events[0], "plugin_event");
  const pluginInstanceId = event.pluginInstanceId;
  assert.match(pluginInstanceId ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(events[0], {
    type: "plugin_event",
    toolCallId: "tool-call-1",
    toolName: "timer_tool",
    pluginInstanceId,
    pluginId: "timer",
    pluginPrefix: undefined,
    pluginNamespace: "timer",
    agentName: "Principal",
    visibility: "user",
    body: {
      type: "status",
      message: "Timer fired",
    },
  });
});

test("plugin-facing runtime contexts do not expose plugin instance ids", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const binding = controller.bindPlugin(pluginIdentity("browser"));
  const toolContext = binding.toolRuntime.forToolCall({
    toolCallId: "tool-call-1",
    toolName: "browser_tool",
  });

  assert.equal("pluginInstanceId" in binding.runtime, false);
  assert.equal("pluginInstanceId" in binding.runtime.notifications, false);
  assert.equal("pluginInstanceId" in binding.runtime.events, false);
  assert.equal("pluginInstanceId" in toolContext, false);

  const notification = await binding.runtime.notifications.enqueue({
    title: "Visible notification",
    content: {
      content: [{ type: "text", text: "visible" }],
    },
  });
  assert.equal("pluginInstanceId" in notification, false);
});

test("plugin STATE writes disk state and emits summary events", async () => {
  await withTempStateStore(async (stateStore) => {
    const controller = new SessionPluginRuntimeController("Principal");
    const sinkState = createSink();
    controller.configure({ stateStore });
    controller.attach(sinkState.sink);
    const binding = controller.bindPlugin(pluginIdentity("browser"));

    await binding.runtime.events.emit({
      type: "STATE",
      markdown: "# Browser\n\n![Current page](asset://screenshot)",
      assets: [
        {
          id: "screenshot",
          fileName: "page.png",
          contentType: "image/png",
          bytes: Buffer.from("image-bytes"),
        },
      ],
    });

    assert.equal(sinkState.events.length, 1);
    const event = requireEvent(sinkState.events[0], "plugin_state");
    assert.equal(event.pluginId, "browser");
    assert.equal(event.pluginPrefix, undefined);
    assert.equal(event.pluginNamespace, "browser");
    assert.match(event.pluginInstanceId, /^[0-9a-f-]{36}$/);

    const states = await controller.listPluginStates();
    assert.equal(states.length, 1);
    assert.equal(states[0]?.pluginId, "browser");
    assert.equal(states[0]?.pluginPrefix, undefined);
    assert.equal(states[0]?.pluginNamespace, "browser");
    assert.equal(states[0]?.pluginInstanceId, event.pluginInstanceId);

    const detail = await controller.readPluginState(
      states[0]!.pluginInstanceId,
    );
    assert.equal(
      detail?.markdown,
      "# Browser\n\n![Current page](asset://screenshot)",
    );
    assert.equal(detail?.pluginInstanceId, states[0]!.pluginInstanceId);

    const asset = await controller.resolvePluginStateAsset(
      states[0]!.pluginInstanceId,
      states[0]!.revision,
      "screenshot",
    );
    assert.equal(asset?.fileName, "page.png");
    assert.equal(asset?.contentType, "image/png");
    assert.equal(await fs.readFile(asset!.absolutePath, "utf8"), "image-bytes");
  });
});

test("plugin STATE replaces previous state and assets", async () => {
  await withTempStateStore(async (stateStore) => {
    const controller = new SessionPluginRuntimeController("Principal");
    controller.configure({ stateStore });
    const binding = controller.bindPlugin(pluginIdentity("tasks"));

    await binding.runtime.events.emit({
      type: "STATE",
      markdown: "first",
      assets: [{ id: "first", bytes: Buffer.from("first") }],
    });
    const first = (await controller.listPluginStates())[0]!;

    await binding.runtime.events.emit({
      type: "STATE",
      markdown: "second",
      assets: [{ id: "second", bytes: Buffer.from("second") }],
    });
    const second = (await controller.listPluginStates())[0]!;

    assert.notEqual(second.revision, first.revision);
    assert.equal(second.pluginInstanceId, first.pluginInstanceId);
    assert.equal(
      (await controller.readPluginState(second.pluginInstanceId))?.markdown,
      "second",
    );
    assert.equal(
      await controller.resolvePluginStateAsset(
        second.pluginInstanceId,
        first.revision,
        "first",
      ),
      null,
    );
    assert.equal(
      (
        await controller.resolvePluginStateAsset(
          second.pluginInstanceId,
          second.revision,
          "second",
        )
      )?.fileName,
      "second",
    );
  });
});

test("same plugin id instances keep independent state", async () => {
  await withTempStateStore(async (stateStore) => {
    const controller = new SessionPluginRuntimeController("Principal");
    controller.configure({ stateStore });
    const firstBrowser = controller.bindPlugin(
      pluginIdentity("browser", "firstBrowser"),
    );
    const secondBrowser = controller.bindPlugin(
      pluginIdentity("browser", "secondBrowser"),
    );

    await firstBrowser.runtime.events.emit({
      type: "STATE",
      markdown: "first browser",
      assets: [
        {
          id: "shot",
          fileName: "first.txt",
          bytes: Buffer.from("first"),
        },
      ],
    });
    await secondBrowser.runtime.events.emit({
      type: "STATE",
      markdown: "second browser",
      assets: [
        {
          id: "shot",
          fileName: "second.txt",
          bytes: Buffer.from("second"),
        },
      ],
    });

    const states = await controller.listPluginStates();
    assert.equal(states.length, 2);
    assert.equal(states[0]?.pluginId, "browser");
    assert.equal(states[1]?.pluginId, "browser");
    assert.deepEqual(
      new Set([states[0]?.pluginNamespace, states[1]?.pluginNamespace]),
      new Set(["firstBrowser__browser", "secondBrowser__browser"]),
    );
    assert.notEqual(states[0]?.pluginInstanceId, states[1]?.pluginInstanceId);

    const firstDetail = await controller.readPluginState(
      states[0]!.pluginInstanceId,
    );
    const secondDetail = await controller.readPluginState(
      states[1]!.pluginInstanceId,
    );
    assert.deepEqual(
      new Set([firstDetail?.markdown, secondDetail?.markdown]),
      new Set(["first browser", "second browser"]),
    );

    const firstAsset = await controller.resolvePluginStateAsset(
      states[0]!.pluginInstanceId,
      states[0]!.revision,
      "shot",
    );
    const secondAsset = await controller.resolvePluginStateAsset(
      states[1]!.pluginInstanceId,
      states[1]!.revision,
      "shot",
    );
    assert.notEqual(firstAsset?.absolutePath, secondAsset?.absolutePath);
    assert.deepEqual(
      new Set([
        firstAsset ? await fs.readFile(firstAsset.absolutePath, "utf8") : "",
        secondAsset ? await fs.readFile(secondAsset.absolutePath, "utf8") : "",
      ]),
      new Set(["first", "second"]),
    );
  });
});

test("plugin LOG emits live only and is not buffered", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const binding = controller.bindPlugin(pluginIdentity("logger"));

  await binding.runtime.events.emit({
    type: "LOG",
    text: "before attach",
  });

  const sinkState = createSink();
  controller.attach(sinkState.sink);
  assert.equal(sinkState.events.length, 0);

  await binding.runtime.events.emit({
    type: "LOG",
    text: "after attach",
  });

  const event = requireEvent(sinkState.events[0], "plugin_log");
  const pluginInstanceId = event.pluginInstanceId;
  assert.match(pluginInstanceId ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(sinkState.events, [
    {
      type: "plugin_log",
      pluginInstanceId,
      pluginId: "logger",
      pluginPrefix: undefined,
      pluginNamespace: "logger",
      agentName: "Principal",
      text: "after attach",
    },
  ]);
});

test("clearPluginStates removes disk state", async () => {
  await withTempStateStore(async (stateStore) => {
    const controller = new SessionPluginRuntimeController("Principal");
    controller.configure({ stateStore });
    const binding = controller.bindPlugin(pluginIdentity("tasks"));

    await binding.runtime.events.emit({
      type: "STATE",
      markdown: "pending",
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
  const binding = controller.bindPlugin(pluginIdentity("subagents"));

  const notification = await binding.runtime.notifications.enqueue({
    title: "Done",
    content: {
      content: [{ type: "text", text: "done" }],
    },
  });

  controller.remove([notification.id]);

  assert.equal(controller.unreadCount(), 0);
  assert.equal(controller.listUnread().length, 0);
  assert.equal(sinkState.stateChangeCount, 2);
});

test("nextUnread returns one notification at a time in inbox order", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const subagents = controller.bindPlugin(pluginIdentity("subagents"));
  const timer = controller.bindPlugin(pluginIdentity("timer"));
  const first = await subagents.runtime.notifications.enqueue({
    title: "First",
    content: {
      content: [{ type: "text", text: "first" }],
    },
  });
  const second = await timer.runtime.notifications.enqueue({
    title: "Second",
    content: {
      content: [{ type: "text", text: "second" }],
    },
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
  const binding = controller.bindPlugin(pluginIdentity("subagents"));

  const first = await binding.runtime.notifications.enqueue({
    title: "First",
    deduplicationId: "worker-1",
    content: {
      content: [{ type: "text", text: "first" }],
    },
  });
  const duplicate = await binding.runtime.notifications.enqueue({
    title: "Duplicate",
    deduplicationId: "worker-1",
    content: {
      content: [{ type: "text", text: "duplicate" }],
    },
  });

  assert.equal(duplicate.id, first.id);
  assert.equal(controller.unreadCount(), 1);
  assert.equal(controller.nextUnread()?.title, "First");
  assert.equal(sinkState.events.length, 1);
  assert.equal(sinkState.stateChangeCount, 1);
});

test("same-name plugin instances do not share notification deduplication", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const firstInstance = controller.bindPlugin(
    pluginIdentity("subagents", "firstSubagents"),
  );
  const secondInstance = controller.bindPlugin(
    pluginIdentity("subagents", "secondSubagents"),
  );

  const first = await firstInstance.runtime.notifications.enqueue({
    title: "First",
    deduplicationId: "worker-1",
    content: {
      content: [{ type: "text", text: "first" }],
    },
  });
  const second = await secondInstance.runtime.notifications.enqueue({
    title: "Second",
    deduplicationId: "worker-1",
    content: {
      content: [{ type: "text", text: "second" }],
    },
  });

  assert.notEqual(second.id, first.id);
  assert.equal(controller.unreadCount(), 2);
});

test("deduplication ids can be reused after pending notification removal", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const binding = controller.bindPlugin(pluginIdentity("subagents"));
  const first = await binding.runtime.notifications.enqueue({
    title: "First",
    deduplicationId: "worker-1",
    content: {
      content: [{ type: "text", text: "first" }],
    },
  });
  controller.remove([first.id]);

  const next = await binding.runtime.notifications.enqueue({
    title: "Next",
    deduplicationId: "worker-1",
    content: {
      content: [{ type: "text", text: "next" }],
    },
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
  const binding = controller.bindPlugin(pluginIdentity("subagents"));
  const notification = await binding.runtime.notifications.enqueue({
    title: "Early notification",
    content: {
      content: [{ type: "text", text: "ready" }],
    },
  });
  const saved: string[] = [];
  const savedPluginInstanceIds: string[] = [];

  controller.configure({
    persistence: {
      saveNotification(persistedNotification) {
        saved.push(persistedNotification.id);
        savedPluginInstanceIds.push(persistedNotification.pluginInstanceId);
      },
      deleteNotifications() {
        return;
      },
      clearNotifications() {
        return;
      },
    },
  });

  assert.deepEqual(saved, [notification.id]);
  assert.match(savedPluginInstanceIds[0] ?? "", /^[0-9a-f-]{36}$/);
  assert.equal("pluginInstanceId" in notification, false);
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
      },
    },
  });

  const notification = await controller
    .bindPlugin(pluginIdentity("subagents"))
    .runtime.notifications.enqueue({
      title: "Done",
      content: {
        content: [{ type: "text", text: "done" }],
      },
    });

  controller.remove([notification.id]);

  assert.deepEqual(deletedIds, [notification.id]);
});

test("form elicitation emits a request and resolves with accepted content", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const sinkState = createSink();
  controller.attach(sinkState.sink);
  const binding = controller.bindPlugin(pluginIdentity("profile"));

  const responsePromise = binding.runtime.elicitation.create({
    mode: "form",
    message: "Provide a profile lookup key.",
    requestedSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          minLength: 2,
        },
        age: {
          type: "integer",
          minimum: 18,
        },
      },
      required: ["username"],
    },
  });

  const pending = controller.listPendingElicitations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.pluginId, "profile");

  const requestEvent = requireEvent(
    sinkState.events[0],
    "plugin_elicitation_request",
  );
  assert.equal(
    requestEvent.payload.elicitationRequestId,
    pending[0]?.elicitationRequestId,
  );

  const result = controller.respondToElicitation(
    pending[0]!.elicitationRequestId,
    {
      action: "accept",
      content: {
        username: "octocat",
        age: 30,
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(await responsePromise, {
    action: "accept",
    content: {
      username: "octocat",
      age: 30,
    },
  });
  assert.equal(controller.listPendingElicitations().length, 0);
  const responseEvent = requireEvent(
    sinkState.events[1],
    "plugin_elicitation_response",
  );
  assert.equal(responseEvent.action, "accept");
  assert.deepEqual(responseEvent.content, {
    username: "octocat",
    age: 30,
  });
  assert.equal(sinkState.stateChangeCount, 2);
});

test("form elicitation rejects schema-invalid accepted content", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const binding = controller.bindPlugin(pluginIdentity("profile"));

  const responsePromise = binding.runtime.elicitation.create({
    message: "Provide a profile lookup key.",
    requestedSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          minLength: 2,
        },
      },
      required: ["username"],
    },
  });

  const pending = controller.listPendingElicitations()[0]!;
  const result = controller.respondToElicitation(pending.elicitationRequestId, {
    action: "accept",
    content: {
      username: "x",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(controller.listPendingElicitations().length, 1);

  const cancelResult = controller.respondToElicitation(
    pending.elicitationRequestId,
    { action: "cancel" },
  );
  assert.deepEqual(cancelResult, { ok: true });
  assert.deepEqual(await responsePromise, { action: "cancel" });
});

test("url elicitation emits completion notifications for known pending ids", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const sinkState = createSink();
  controller.attach(sinkState.sink);
  const binding = controller.bindPlugin(pluginIdentity("auth"));

  const responsePromise = binding.runtime.elicitation.create({
    mode: "url",
    message: "Authorize access.",
    url: "https://example.test/connect",
    elicitationId: "auth-flow-1",
  });
  const pending = controller.listPendingElicitations()[0]!;

  binding.runtime.elicitation.complete({ elicitationId: "unknown" });
  binding.runtime.elicitation.complete({ elicitationId: "auth-flow-1" });

  assert.equal(sinkState.events.length, 2);
  requireEvent(sinkState.events[0], "plugin_elicitation_request");
  const completeEvent = requireEvent(
    sinkState.events[1],
    "plugin_elicitation_complete",
  );
  assert.equal(
    completeEvent.elicitationRequestId,
    pending.elicitationRequestId,
  );
  assert.equal(completeEvent.elicitationId, "auth-flow-1");

  controller.respondToElicitation(pending.elicitationRequestId, {
    action: "accept",
    content: {
      ignored: true,
    },
  });

  assert.deepEqual(await responsePromise, { action: "accept" });
});

test("cancelPendingElicitations resolves all pending requests as cancel", async () => {
  const controller = new SessionPluginRuntimeController("Principal");
  const binding = controller.bindPlugin(pluginIdentity("tasks"));
  const first = binding.runtime.elicitation.create({
    message: "First value.",
    requestedSchema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    },
  });
  const second = binding.runtime.elicitation.create({
    message: "Second value.",
    requestedSchema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
    },
  });

  assert.equal(controller.listPendingElicitations().length, 2);

  controller.cancelPendingElicitations();

  assert.equal(controller.listPendingElicitations().length, 0);
  assert.deepEqual(await first, { action: "cancel" });
  assert.deepEqual(await second, { action: "cancel" });
});
