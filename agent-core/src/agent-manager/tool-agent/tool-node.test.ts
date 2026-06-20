import { describe, expect, it } from "@jest/globals";
import { AIMessage } from "@langchain/core/messages";
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
import { toolNodeFunction } from "./tool-node.js";

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

describe("toolNodeFunction", () => {
  it("routes tool calls through the matching plugin runtime", async () => {
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

    const node = toolNodeFunction([
      toolEntry("first", [firstTool], runtimeFor("first")),
      toolEntry("second", [secondTool], runtimeFor("second")),
    ]);

    const result = await node(
      {
        messages: [
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "tool-call-1",
                name: "second__echo",
                args: { value: "hello" },
              },
            ],
          }),
        ],
      } as any,
      {} as any,
    );

    expect(runtimeHits).toEqual(["second"]);
    expect(firstTool.context).toBeUndefined();
    expect(secondTool.context).toMatchObject({
      toolCallId: "tool-call-1",
      toolName: "second__echo",
    });
    expect(result.messages).toHaveLength(1);
  });
});
