import { describe, expect, it } from "@jest/globals";
import type { AddressInfo } from "net";
import { WebSocketServer } from "ws";
import { z } from "zod/v4";
import type { AgentPlugin, PluginFactory } from "../../plugins/index.js";
import {
  AgentTool,
  type ToolCallRuntimeContext,
  type ToolInputSchemaBase,
  type ToolRuntimeProvider,
} from "../../tools/index.js";
import type {
  RuntimePluginEntry,
  RuntimePluginToolEntry,
} from "../runtime-tools.js";
import { toolHandler } from "./tool-node.js";

class CapturingTool extends AgentTool {
  name: string;
  description = "Captures runtime context.";
  schema = z.object({
    value: z.string(),
  });
  context: ToolCallRuntimeContext | undefined;

  constructor(name: string) {
    super();
    this.name = name;
  }

  protected async _call(
    input: z.output<this["schema"]>,
    context: ToolCallRuntimeContext,
  ) {
    this.context = context;
    return [{ type: "text" as const, text: input.value }];
  }
}

function runtimeEntry(
  pluginId: string,
  toolRuntime: ToolRuntimeProvider,
): RuntimePluginEntry {
  return {
    plugin: {} as AgentPlugin,
    pluginId,
    pluginNamespace: pluginId,
    factory: {} as PluginFactory,
    label: pluginId,
    toolRuntime,
  };
}

function toolEntry(
  pluginId: string,
  tools: AgentTool<ToolInputSchemaBase, any, any>[],
  toolRuntime: ToolRuntimeProvider,
): RuntimePluginToolEntry {
  return {
    entry: runtimeEntry(pluginId, toolRuntime),
    tools,
  };
}

describe("code-agent toolHandler", () => {
  it("routes Python tool calls through the matching plugin runtime", async () => {
    const firstTool = new CapturingTool("first__echo");
    const secondTool = new CapturingTool("second__echo");
    const runtimeHits: string[] = [];
    const runtimeFor = (pluginId: string): ToolRuntimeProvider => ({
      forToolCall(source) {
        runtimeHits.push(pluginId);
        return {
          ...source,
          emitEvent() {
            return;
          },
          elicitation: {
            async create() {
              throw new Error("not expected");
            },
            complete() {
              return;
            },
          },
        };
      },
    });
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const responsePromise = new Promise<any>((resolve, reject) => {
      server.once("error", reject);
      server.once("connection", (socket) => {
        socket.once("message", (data) => {
          const response = JSON.parse(data.toString());
          socket.once("close", () => {
            server.close(() => resolve(response));
          });
          socket.close();
        });
        socket.send(
          JSON.stringify({
            request: {
              method: "second__echo",
              arguments: { value: "hello" },
              call_id: "python-call-1",
            },
          }),
        );
      });
    });

    const client = toolHandler(
      `ws://127.0.0.1:${address.port}`,
      [
        toolEntry("first", [firstTool], runtimeFor("first")),
        toolEntry("second", [secondTool], runtimeFor("second")),
      ],
      new Map(),
    );
    const clientClosed = new Promise<void>((resolve) =>
      client.once("close", () => resolve()),
    );
    const response = await responsePromise;
    await clientClosed;

    expect(runtimeHits).toEqual(["second"]);
    expect(firstTool.context).toBeUndefined();
    expect(secondTool.context).toMatchObject({
      toolCallId: "python-call-1",
      toolName: "second__echo",
    });
    expect(response.response.result.value).toBe(
      "<<TOOL_RESPONSE:python-call-1>>",
    );
  });
});
