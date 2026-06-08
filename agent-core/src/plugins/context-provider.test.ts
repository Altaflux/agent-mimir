import { describe, expect, it } from "@jest/globals";
import { z } from "zod/v4";
import { InputAgentMessage } from "../agent-manager/index.js";
import {
  PluginContextProvider,
  PluginContextProviderEntry,
} from "../plugins/context-provider.js";
import { AdditionalContent, AgentPlugin, AgentSystemMessage } from "./index.js";
import { AgentTool, ToolResponse } from "../tools/index.js";

class DummyTool extends AgentTool {
  name = "officePCControl__desktopPlugin__clickMouse";
  description = "Click the mouse.";
  schema = z.object({});

  protected async _call(): Promise<ToolResponse> {
    return [];
  }
}

class DummyPlugin extends AgentPlugin {
  constructor(
    private readonly content: AdditionalContent[],
    private readonly systemMessages: AgentSystemMessage = { content: [] },
  ) {
    super();
  }

  async getSystemMessages(): Promise<AgentSystemMessage> {
    return this.systemMessages;
  }

  async additionalMessageContent(): Promise<AdditionalContent[]> {
    return this.content;
  }
}

function createEntry(
  label: string,
  plugin: AgentPlugin,
  tools: AgentTool[] = [],
): PluginContextProviderEntry {
  return {
    label,
    plugin,
    tools,
  };
}

describe("PluginContextProvider", () => {
  const initialMessage: InputAgentMessage = {
    content: [{ type: "text", text: "Original user message." }],
  };

  it("returns the original message when no plugins are provided", async () => {
    const provider = new PluginContextProvider([], {});

    const result = await provider.additionalMessageContent(initialMessage);

    expect(result).toEqual({
      displayMessage: {
        content: [{ type: "text", text: "Original user message." }],
      },
      persistentMessage: {
        message: {
          content: [{ type: "text", text: "Original user message." }],
        },
        retentionPolicy: [null],
      },
    });
  });

  it("uses entry labels for display and persistent additional content headers", async () => {
    const provider = new PluginContextProvider(
      [
        createEntry(
          "officePCControl / desktopPlugin",
          new DummyPlugin([
            {
              content: [{ type: "text", text: "Display content." }],
              saveToChatHistory: 3,
              displayOnCurrentMessage: true,
            },
          ]),
        ),
      ],
      {},
    );

    const result = await provider.additionalMessageContent(initialMessage);

    const expectedAddedContent = [
      {
        type: "text",
        text: "\n### PLUGIN officePCControl / desktopPlugin CONTEXT ###\n",
      },
      { type: "text", text: "Display content." },
      { type: "text", text: "\n" },
    ];
    expect(result.displayMessage.content).toEqual([
      initialMessage.content[0],
      ...expectedAddedContent,
    ]);
    expect(result.persistentMessage.message.content).toEqual([
      initialMessage.content[0],
      ...expectedAddedContent,
    ]);
    expect(result.persistentMessage.retentionPolicy).toEqual([null, 3, 3, 3]);
  });

  it("preserves normalized plugin entry order without nameless separators", async () => {
    const provider = new PluginContextProvider(
      [
        createEntry(
          "firstPlugin",
          new DummyPlugin([
            {
              content: [{ type: "text", text: "First" }],
              saveToChatHistory: false,
              displayOnCurrentMessage: true,
            },
          ]),
        ),
        createEntry(
          "secondPlugin",
          new DummyPlugin([
            {
              content: [{ type: "text", text: "Second" }],
              saveToChatHistory: false,
              displayOnCurrentMessage: true,
            },
          ]),
        ),
      ],
      {},
    );

    const result = await provider.additionalMessageContent(initialMessage);

    expect(result.displayMessage.content).toEqual([
      initialMessage.content[0],
      { type: "text", text: "\n### PLUGIN firstPlugin CONTEXT ###\n" },
      { type: "text", text: "First" },
      { type: "text", text: "\n" },
      { type: "text", text: "\n### PLUGIN secondPlugin CONTEXT ###\n" },
      { type: "text", text: "Second" },
      { type: "text", text: "\n" },
    ]);
  });

  it("uses entry labels and public tool names in system prompt context", async () => {
    const provider = new PluginContextProvider(
      [
        createEntry(
          "officePCControl / desktopPlugin",
          new DummyPlugin([], {
            content: [{ type: "text", text: "Desktop control context." }],
          }),
          [new DummyTool()],
        ),
      ],
      {},
    );

    const result = await provider.getSystemPromptContext();

    expect(result).toEqual([
      expect.objectContaining({ type: "text" }),
      {
        type: "text",
        text: "\n\n### PLUGIN: officePCControl / desktopPlugin ###\n\n",
      },
      { type: "text", text: "Desktop control context." },
      {
        type: "text",
        text: "\nThe plugin provides and manages the following tools/functions:\n- officePCControl__desktopPlugin__clickMouse",
      },
    ]);
  });
});
