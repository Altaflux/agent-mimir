import { Agent, AgentWorkspace } from "../index.js";
import { AgentFactory, AgentConfig } from "../factory.js";
import { createAgent as createCodeAgent } from "./agent.js";
import { PluginConfig } from "../../plugins/index.js";
import { CodeToolExecutor } from "./index.js";

export type CodeAgentConfig = {
  codeExecutor: (workspace: AgentWorkspace) => CodeToolExecutor;
} & AgentConfig;
/**
 * Factory for creating code agents.
 * Implements the AgentFactory interface for code agents.
 */
export class CodeAgentFactory implements AgentFactory {
  private config: CodeAgentConfig;

  /**
   * Creates a new CodeAgentFactory with the specified configuration.
   * @param config Configuration for the code agent
   */
  constructor(config: CodeAgentConfig) {
    this.config = config;
  }

  /**
   * Creates a code agent with the specified plugins.
   * @param plugins Named plugin factories to extend agent functionality
   * @returns A Promise that resolves to the created code agent
   */
  async create(name: string, plugins: PluginConfig): Promise<Agent> {
    return createCodeAgent({
      ...this.config,
      name: name,
      plugins: [...plugins, ...(this.config.plugins ?? [])],
    });
  }
}
