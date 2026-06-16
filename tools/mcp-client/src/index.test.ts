import assert from "node:assert/strict";
import test from "node:test";
import type {
  ElicitationCompleteNotification,
  ElicitRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  PluginElicitationCreateRequest,
  PluginRuntimeContext,
} from "@mimir/agent-core/plugins";
import {
  createMcpElicitationCompleteHandler,
  createMcpElicitationRequestHandler,
} from "./index.js";

function createRuntime(
  onCreate: (input: PluginElicitationCreateRequest) => void,
  onComplete: (elicitationId: string) => void,
): PluginRuntimeContext {
  return {
    notifications: {
      async enqueue(input) {
        return {
          id: "notification-1",
          pluginId: "mcpClient",
          pluginNamespace: "mcpClient",
          agentName: "Principal",
          createdAt: Date.now(),
          title: input.title,
          summary: input.summary,
          deduplicationId: input.deduplicationId,
          content: input.content,
        };
      },
    },
    events: {
      emit() {
        return;
      },
    },
    elicitation: {
      async create(input) {
        onCreate(input);
        return {
          action: "accept",
          content: {
            value: "accepted",
          },
        };
      },
      complete(input) {
        onComplete(input.elicitationId);
      },
    },
  };
}

test("MCP elicitation request handler delegates to plugin runtime", async () => {
  let received: PluginElicitationCreateRequest | undefined;
  const runtime = createRuntime(
    (input) => {
      received = input;
    },
    () => {
      return;
    },
  );
  const handler = createMcpElicitationRequestHandler(runtime);

  const result = await handler({
    method: "elicitation/create",
    params: {
      mode: "form",
      message: "Pick a value.",
      requestedSchema: {
        type: "object",
        properties: {
          value: {
            type: "string",
          },
        },
        required: ["value"],
      },
    },
  } as ElicitRequest);

  assert.deepEqual(received, {
    mode: "form",
    message: "Pick a value.",
    requestedSchema: {
      type: "object",
      properties: {
        value: {
          type: "string",
        },
      },
      required: ["value"],
    },
  });
  assert.deepEqual(result, {
    action: "accept",
    content: {
      value: "accepted",
    },
  });
});

test("MCP elicitation completion notification delegates to plugin runtime", () => {
  let completed: string | undefined;
  const runtime = createRuntime(
    () => {
      return;
    },
    (elicitationId) => {
      completed = elicitationId;
    },
  );
  const handler = createMcpElicitationCompleteHandler(runtime);

  handler({
    method: "notifications/elicitation/complete",
    params: {
      elicitationId: "auth-flow-1",
    },
  } as ElicitationCompleteNotification);

  assert.equal(completed, "auth-flow-1");
});
