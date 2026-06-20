import assert from "node:assert/strict";
import test from "node:test";
import type {
  ElicitationCompleteNotification,
  ElicitRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { PluginElicitationCreateRequest } from "@mimir/agent-core/plugins";
import type { ToolCallRuntimeContext } from "@mimir/agent-core/tools";
import {
  createMcpElicitationCompleteHandler,
  createMcpElicitationRequestHandler,
  McpElicitationBridge,
} from "./index.js";

function createToolContext(
  onCreate: (input: PluginElicitationCreateRequest) => Promise<{
    action: "accept";
    content: Record<string, unknown>;
  }>,
  onComplete: (elicitationId: string) => void = () => {
    return;
  },
): ToolCallRuntimeContext {
  return {
    toolCallId: "tool-call-1",
    toolName: "mcpClient__tool",
    emitEvent() {
      return;
    },
    elicitation: {
      create: onCreate,
      complete(input) {
        onComplete(input.elicitationId);
      },
    },
  };
}

function formRequest(): ElicitRequest {
  return {
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
  } as ElicitRequest;
}

test("MCP elicitation request handler delegates to active tool runtime", async () => {
  const bridge = new McpElicitationBridge();
  let received: PluginElicitationCreateRequest | undefined;
  const context = createToolContext(async (input) => {
    received = input;
    return {
      action: "accept",
      content: {
        value: "accepted",
      },
    };
  });
  const handler = createMcpElicitationRequestHandler(bridge);

  const result = await bridge.runWithToolContext(context, async () =>
    handler(formRequest()),
  );

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

test("MCP elicitation request handler rejects without an active tool runtime", async () => {
  const bridge = new McpElicitationBridge();
  const handler = createMcpElicitationRequestHandler(bridge);

  await assert.rejects(
    async () => await handler(formRequest()),
    /only supported during an active Mimir tool call/,
  );
});

test("MCP elicitation request handler rejects ambiguous active tool runtimes", async () => {
  const bridge = new McpElicitationBridge();
  const handler = createMcpElicitationRequestHandler(bridge);
  const contextA = createToolContext(async () => ({
    action: "accept",
    content: {},
  }));
  const contextB = createToolContext(async () => ({
    action: "accept",
    content: {},
  }));

  await assert.rejects(
    async () =>
      await Promise.all([
        bridge.runWithToolContext(
          contextA,
          async () =>
            await bridge.runWithToolContext(
              contextB,
              async () => await handler(formRequest()),
            ),
        ),
      ]),
    /multiple MCP operations are active/,
  );
});

test("MCP elicitation completion notification delegates to active URL completion callback", async () => {
  const bridge = new McpElicitationBridge();
  const requestHandler = createMcpElicitationRequestHandler(bridge);
  const completeHandler = createMcpElicitationCompleteHandler(bridge);
  let completed: string | undefined;
  let resolveCreate:
    | ((value: { action: "accept"; content: Record<string, unknown> }) => void)
    | undefined;
  const context = createToolContext(
    async () =>
      await new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    (elicitationId) => {
      completed = elicitationId;
    },
  );

  const pending = bridge.runWithToolContext(context, async () =>
    requestHandler({
      method: "elicitation/create",
      params: {
        mode: "url",
        message: "Authorize access.",
        url: "https://example.test/connect",
        elicitationId: "auth-flow-1",
      },
    } as ElicitRequest),
  );
  await Promise.resolve();

  completeHandler({
    method: "notifications/elicitation/complete",
    params: {
      elicitationId: "unknown",
    },
  } as ElicitationCompleteNotification);
  assert.equal(completed, undefined);

  completeHandler({
    method: "notifications/elicitation/complete",
    params: {
      elicitationId: "auth-flow-1",
    },
  } as ElicitationCompleteNotification);
  assert.equal(completed, "auth-flow-1");

  resolveCreate?.({ action: "accept", content: {} });
  assert.deepEqual(await pending, { action: "accept", content: {} });
});
