import { describe, expect, it } from "@jest/globals";
import {
  Agent,
  AgentFactory,
  AgentWorkspace,
  IntermediateAgentMessage,
} from "../agent-manager/index.js";
import { PluginConfig } from "../plugins/index.js";
import { OrchestratorBuilder } from "./multi-agent.js";

const workspace: AgentWorkspace = {
  listFiles: async () => [],
  loadFileToWorkspace: async () => undefined,
  reset: async () => undefined,
  getUrlForFile: async () => undefined,
  fileAsBuffer: async () => undefined,
  workingDirectory: "",
  rootDirectory: "",
};

class StaticAgent implements Agent {
  description = "Test principal agent";
  commands = [];
  workspace = workspace;

  constructor(public name: string) {}

  async *call(): AsyncGenerator<
    IntermediateAgentMessage,
    {
      message: {
        checkpointId: string;
        type: "agentResponse";
        output: {
          id: string;
          content: [{ type: "text"; text: string }];
        };
        responseAttributes: Record<string, string>;
      };
      checkpointId: string;
    },
    unknown
  > {
    yield {
      type: "messageChunk",
      id: "chunk-1",
      content: [{ type: "text", text: "Working" }],
      responseAttributes: { destinationAgent: "legacy-worker" },
    };

    return {
      checkpointId: "checkpoint-1",
      message: {
        checkpointId: "checkpoint-1",
        type: "agentResponse",
        output: {
          id: "message-1",
          content: [{ type: "text", text: "Done" }],
        },
        responseAttributes: { destinationAgent: "legacy-worker" },
      },
    };
  }

  async *handleCommand(): AsyncGenerator<
    IntermediateAgentMessage,
    {
      message: {
        checkpointId: string;
        type: "agentResponse";
        output: {
          id: string;
          content: [{ type: "text"; text: string }];
        };
        responseAttributes: Record<string, string>;
      };
      checkpointId: string;
    },
    unknown
  > {
    return {
      checkpointId: "checkpoint-command",
      message: {
        checkpointId: "checkpoint-command",
        type: "agentResponse",
        output: {
          id: "message-command",
          content: [{ type: "text", text: "Command done" }],
        },
        responseAttributes: {},
      },
    };
  }

  async reset(): Promise<void> {}

  async shutDown(): Promise<void> {}
}

class CapturingFactory implements AgentFactory {
  pluginsPassed: PluginConfig | undefined;

  async create(name: string, plugins: PluginConfig): Promise<Agent> {
    this.pluginsPassed = plugins;
    return new StaticAgent(name);
  }
}

describe("MultiAgentCommunicationOrchestrator", () => {
  it("does not inject legacy helper plugins when creating a principal agent", async () => {
    const factory = new CapturingFactory();
    const builder = new OrchestratorBuilder("session-1");

    await builder.initializeAgent(factory, "Principal");

    expect(factory.pluginsPassed).toEqual([]);
  });

  it("does not route principal responses through legacy destination attributes", async () => {
    const factory = new CapturingFactory();
    const builder = new OrchestratorBuilder("session-1");
    const principal = await builder.initializeAgent(factory, "Principal");
    const orchestrator = builder.build(principal);

    const generator = orchestrator.handleMessage(
      {
        input: {
          type: "user_message",
          message: {
            content: [{ type: "text", text: "Hello" }],
          },
        },
      },
      "session-1",
    );

    const first = await generator.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      type: "intermediateOutput",
      agentName: "Principal",
      value: {
        type: "messageChunk",
        id: "chunk-1",
        content: [{ type: "text", text: "Working" }],
      },
    });

    const final = await generator.next();
    expect(final.done).toBe(true);
    expect(final.value).toEqual({
      type: "agentResponse",
      content: {
        id: "message-1",
        content: [{ type: "text", text: "Done" }],
      },
    });
  });
});
