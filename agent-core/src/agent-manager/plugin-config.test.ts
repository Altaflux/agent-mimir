import { describe, expect, it } from "@jest/globals";
import { z } from "zod/v4";
import {
  AgentPlugin,
  PluginConfig,
  PluginContext,
  PluginFactory,
} from "../plugins/index.js";
import {
  AgentTool,
  ToolCallRuntimeContext,
  ToolResponse,
} from "../tools/index.js";
import {
  assertUniqueToolNames,
  createPublicPluginTool,
  normalizePluginConfig,
} from "./plugin-config.js";

class NavigateTool extends AgentTool {
  name = "navigate";
  description = "Navigate somewhere.";
  schema = z.object({
    url: z.string(),
  });

  capturedContext: ToolCallRuntimeContext | undefined;

  protected async _call(
    input: z.output<this["schema"]>,
    context: ToolCallRuntimeContext,
  ): Promise<ToolResponse> {
    this.capturedContext = context;
    await context.emitEvent({
      body: {
        type: "status",
        message: input.url,
      },
    });
    return [{ type: "text", text: input.url }];
  }
}

class TransformTool extends AgentTool {
  name = "double";
  description = "Doubles a numeric string.";
  schema = z.string().transform((value) => Number(value));

  capturedInput: number | undefined;

  protected async _call(
    input: z.output<this["schema"]>,
  ): Promise<ToolResponse> {
    this.capturedInput = input;
    return [{ type: "text", text: String(input * 2) }];
  }
}

class ToolPlugin extends AgentPlugin {
  async tools(): Promise<AgentTool[]> {
    return [new NavigateTool()];
  }
}

class ToolPluginFactory implements PluginFactory {
  constructor(public pluginId = "browserPlugin") {}

  async create(_context: PluginContext): Promise<AgentPlugin> {
    return new ToolPlugin();
  }
}

const context = {} as PluginContext;

async function publicToolsForConfig(
  config: PluginConfig,
): Promise<AgentTool[]> {
  const entries = normalizePluginConfig(config, []);
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const plugin = await entry.factory.create(context);
        return (await plugin.tools()).map((tool) =>
          createPublicPluginTool(entry.pluginNamespace, tool),
        );
      }),
    )
  ).flat();
}

describe("named plugin config", () => {
  it("exposes plugin-prefixed public tool names for a single plugin instance", async () => {
    const factory = new ToolPluginFactory();

    const tools = await publicToolsForConfig([{ factory }]);

    expect(tools.map((tool) => tool.name)).toEqual(["browserPlugin__navigate"]);
  });

  it("exposes prefix and plugin id for two instances of the same factory", async () => {
    const factory = new ToolPluginFactory("desktopPlugin");

    const tools = await publicToolsForConfig([
      { prefix: "officePCControl", factory },
      { prefix: "homePCControl", factory },
    ]);

    expect(tools.map((tool) => tool.name)).toEqual([
      "officePCControl__desktopPlugin__navigate",
      "homePCControl__desktopPlugin__navigate",
    ]);
  });

  it("rejects invalid plugin ids and prefixes", () => {
    const factory = new ToolPluginFactory();

    expect(() =>
      normalizePluginConfig(
        [{ factory: new ToolPluginFactory("bad-name") }],
        [],
      ),
    ).toThrow(/Invalid pluginId/);
    expect(() =>
      normalizePluginConfig([{ prefix: "bad-name", factory }], []),
    ).toThrow(/Invalid plugin prefix/);
  });

  it("rejects repeated plugin ids when any repeated instance is unprefixed", () => {
    const factory = new ToolPluginFactory("desktopPlugin");

    expect(() =>
      normalizePluginConfig(
        [{ factory }, { prefix: "officePCControl", factory }],
        [],
      ),
    ).toThrow(/configured more than once/);
  });

  it("rejects duplicate plugin namespaces", () => {
    const factory = new ToolPluginFactory("desktopPlugin");

    expect(() =>
      normalizePluginConfig(
        [
          { prefix: "officePCControl", factory },
          { prefix: "officePCControl", factory },
        ],
        [],
      ),
    ).toThrow(/Duplicate plugin namespace/);
  });

  it("rejects duplicate public tool names", () => {
    const tools = [
      createPublicPluginTool("browserPlugin", new NavigateTool()),
      createPublicPluginTool("browserPlugin", new NavigateTool()),
    ];

    expect(() => assertUniqueToolNames(tools)).toThrow(
      /Duplicate public tool name "browserPlugin__navigate"/,
    );
  });

  it("delegates execution through the public tool name runtime context", async () => {
    const originalTool = new NavigateTool();
    const publicTool = createPublicPluginTool("browserPlugin", originalTool);
    const emittedToolNames: string[] = [];

    publicTool.bindPluginRuntime({
      forToolCall(source) {
        return {
          ...source,
          emitEvent() {
            emittedToolNames.push(source.toolName);
          },
          elicitation: {
            async create() {
              return { action: "cancel" as const };
            },
            complete() {
              return;
            },
          },
        };
      },
    });

    await publicTool.invoke(
      { url: "https://example.test" },
      { toolCallId: "tool-call-1", toolName: publicTool.name },
    );

    expect(publicTool.name).toBe("browserPlugin__navigate");
    expect(originalTool.capturedContext?.toolName).toBe(
      "browserPlugin__navigate",
    );
    expect(emittedToolNames).toEqual(["browserPlugin__navigate"]);
  });

  it("delegates parsed tool input without validating through the delegate twice", async () => {
    const originalTool = new TransformTool();
    const publicTool = createPublicPluginTool("mathPlugin", originalTool);

    const response = await publicTool.invoke("21", {
      toolCallId: "tool-call-1",
      toolName: publicTool.name,
    });

    expect(originalTool.capturedInput).toBe(21);
    expect(response).toEqual([{ type: "text", text: "42" }]);
  });
});
