import { Agent } from "./index.js";
import { PluginFactory } from "../plugins/index.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { WorkspaceFactory } from "./index.js";
import { BaseCheckpointSaver } from "@langchain/langgraph";

/**
 * Configuration for creating an agent.
 * Contains all necessary parameters except plugins, which are provided separately.
 */
export interface AgentConfig {
    /** The professional role or expertise of the agent */
    profession: string;
    /** A description of the agent's purpose and capabilities */
    description: string;
    /** The unique name identifier for the agent */
    // name: string;
    /** The language model to be used by the agent */
    model: BaseChatModel;
    /** Optional constitution defining agent behavior guidelines */
    constitution?: string;
    /** Optional vision support type */
    visionSupport?: boolean;
    /** Factory function to create the agent's workspace */
    workspaceFactory: WorkspaceFactory;

    plugins: PluginFactory[],

    checkpointer?: BaseCheckpointSaver
}

/**
 * Interface for agent factories that create different types of agents.
 * Provides a common interface for creating agents regardless of their implementation.
 */
export interface AgentFactory {
    /**
     * Creates an agent with the specified plugins.
     * @param plugins Array of plugin factories to extend agent functionality
     * @returns A Promise that resolves to the created agent
     */
    create(name: string, plugins: PluginFactory[]): Promise<Agent>;
}