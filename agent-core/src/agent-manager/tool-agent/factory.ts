import { Agent } from "../index.js";
import { AgentFactory, AgentConfig } from "../factory.js";
import { createAgent as createFunctionAgent } from "./agent.js";
import { PluginConfig } from "../../plugins/index.js";

/**
 * Factory for creating function agents.
 * Implements the AgentFactory interface for function agents.
 */
export class FunctionAgentFactory implements AgentFactory {
  private config: AgentConfig;

  /**
   * Creates a new FunctionAgentFactory with the specified configuration.
   * @param config Configuration for the function agent
   */
  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Creates a function agent with the specified plugins.
   * @param plugins Named plugin factories to extend agent functionality
   * @returns A Promise that resolves to the created function agent
   */
  async create(name: string, plugins: PluginConfig): Promise<Agent> {
    return createFunctionAgent({
      ...this.config,
      name: name,
      plugins: [...plugins, ...(this.config.plugins ?? [])],
    });
  }
}
