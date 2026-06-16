import { describe, expect, it } from "@jest/globals";
import type { AgentWorkspace } from "../agent-manager/index.js";
import {
  createPluginContext,
  type PluginElicitationCreateRequest,
  type PluginElicitationResponse,
  type PluginRuntimeContext,
} from "./index.js";
import { DefaultPluginFactory } from "./default-plugins.js";

function createWorkspace(): AgentWorkspace {
  return {
    workingDirectory: "C:/tmp/mimir-test",
    rootDirectory: "C:/tmp/mimir-test",
    async listFiles() {
      return [];
    },
    async loadFileToWorkspace() {
      return;
    },
    async reset() {
      return;
    },
    async getUrlForFile() {
      return undefined;
    },
    async fileAsBuffer() {
      return undefined;
    },
  };
}

function createRuntime(
  elicitationResponse: PluginElicitationResponse = { action: "cancel" },
  onElicitationCreate?: (input: PluginElicitationCreateRequest) => void,
): PluginRuntimeContext {
  return {
    notifications: {
      async enqueue(input) {
        return {
          id: "notification-1",
          pluginId: "core",
          pluginNamespace: "core",
          agentName: "Agent",
          createdAt: Date.now(),
          title: input.title,
          summary: input.summary,
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
        onElicitationCreate?.(input);
        return elicitationResponse;
      },
      complete() {
        return;
      },
    },
  };
}

describe("DefaultPluginFactory", () => {
  it("provides the default ask_user elicitation tool", async () => {
    expect(new DefaultPluginFactory().pluginId).toBe("core");
    const plugin = await new DefaultPluginFactory().create(
      createPluginContext(createWorkspace(), createRuntime()),
    );

    const tools = await plugin.tools();

    expect(tools.map((tool) => tool.name)).toContain("ask_user");
  });

  it("uses plugin-level elicitation to ask the user for structured input", async () => {
    let request: PluginElicitationCreateRequest | undefined;
    const plugin = await new DefaultPluginFactory().create(
      createPluginContext(
        createWorkspace(),
        createRuntime(
          {
            action: "accept",
            content: {
              priority: "high",
            },
          },
          (input) => {
            request = input;
          },
        ),
      ),
    );
    const askUser = (await plugin.tools()).find(
      (tool) => tool.name === "ask_user",
    );
    expect(askUser).toBeDefined();

    const response = await askUser!.invoke(
      {
        message: "Which priority should I use?",
        fields: [
          {
            name: "priority",
            title: "Priority",
            type: "single_select",
            options: [
              { value: "normal", title: "Normal" },
              { value: "high", title: "High" },
            ],
          },
        ],
      },
    );

    expect(request).toEqual({
      mode: "form",
      message: "Which priority should I use?",
      requestedSchema: {
        type: "object",
        properties: {
          priority: {
            title: "Priority",
            description: undefined,
            type: "string",
            oneOf: [
              { const: "normal", title: "Normal" },
              { const: "high", title: "High" },
            ],
          },
        },
        required: ["priority"],
      },
    });
    expect(response).toEqual([
      {
        type: "text",
        text:
          "The user answered the elicitation request.\n\n" +
          JSON.stringify({ priority: "high" }, null, 2),
      },
    ]);
  });
});
