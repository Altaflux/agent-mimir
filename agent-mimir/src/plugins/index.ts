import { AgentMessageToolRequest, AgentWorkspace, InputAgentMessage } from "../agent-manager/index.js";
import { ComplexMessageContent } from "../schema.js";
import { AgentTool } from "../tools/index.js";

/** 
 * Represents a message response from the AI agent containing a tool request.
 */
export type AiResponseMessage = AgentMessageToolRequest;

/** 
 * Describes an attribute that a plugin can provide for the agent to populate.
 * Used to generate additional data useful for the plugin.
 */
export type AttributeDescriptor = {
    name: string,
    attributeType: string,
    variableName: string,
    description: string,
    required: boolean,
    example?: string,
}

/** 
 * Represents a command that can be executed by the agent.
 * Similar to Discord commands, these are used to interact with the agent.
 */
export type AgentCommand = {
    name: string,
    description?: string,
    commandHandler: (args: Record<string, any>) => Promise<CommandContent[]>,
    arguments?: {
        name: string,
        description?: string,
        required: boolean
    }[]
}


/** 
 * Context provided to plugins during initialization.
 * Contains workspace, persistence directory, and agent information.
 */
export type PluginContext = {
    workspace: AgentWorkspace,
}



/** 
 * Represents the next message in the conversation flow.
 * Can be either a user message or a tool response.
 */
export type NextMessage = NextMessageUser | NextMessageToolResponse;

/** 
 * Represents a user message in the conversation flow.
 */
export type NextMessageUser = InputAgentMessage & { type: "USER_MESSAGE" }

/** 
 * Represents a tool's response message in the conversation flow.
 */
export type NextMessageToolResponse = {
    type: "TOOL_RESPONSE",
    toolCallId: string,
    toolName: string,
    content: ComplexMessageContent[]
}


/** 
 * Represents additional content that can be added to messages.
 * Controls whether content should be saved to history and/or displayed.
 */
export type AdditionalContent = {
    saveToChatHistory: boolean | number,
    displayOnCurrentMessage: boolean,
    content: ComplexMessageContent[]
}


/** 
 * Factory interface for creating Mimir agent plugins.
 * Provides a standardized way to instantiate plugins with context.
 */
export interface PluginFactory {
    name: string;
    create(context: PluginContext): Promise<AgentPlugin>
}

/**
 * Abstract base class for Mimir agent plugins.
 * Provides the core functionality and lifecycle hooks that plugins can implement.
 */
export abstract class AgentPlugin {

    /**
     * Name of the plugin.
     */
    name?: string;
    

    /**
     * Initializes the plugin.
     * Called when the plugin is first loaded.
     */
    init(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Called when the agent is ready to proceed to the next message.
     * Allows plugins to prepare for the next interaction.
     * @param nextMessage - The next message in the conversation
     */
    async readyToProceed(nextMessage: NextMessage): Promise<void> {
    }

    /**
     * Adds additional content to the user's message.
     * @returns Array of additional content to be added
     */
    async additionalMessageContent(message: InputAgentMessage): Promise<AdditionalContent[]> {
        return [];
    }

    /**
     * Adds additional content to the system message.
     * @returns System message content to be added
     */
    async getSystemMessages(): Promise<AgentSystemMessage> {
        return {
            content: []
        };
    }

    /**
     * Reads the response from the agent and processes response attributes.
     * @param aiMessage - The response message from the AI
     * @param responseAttributes - Current response attributes
     */
    async readResponse(aiMessage: AiResponseMessage, responseAttributes: Record<string, any>): Promise<void> {
        return;
    }

    /**
     * Resets the plugin to its initial state.
     */
    async reset(): Promise<void> {
    }

    /**
     * Returns the attributes that the plugin can provide for the agent to populate.
     * These attributes are used to generate additional data useful for the plugin.
     * @param context - Current agent context
     * @returns Array of attribute descriptors
     */
    async attributes(nextMessage: NextMessage): Promise<AttributeDescriptor[]> {
        return [];
    }

    /**
     * Returns the tools that the plugin provides to the agent.
     * @returns Array of agent tools, either synchronously or as a promise
     */
    async tools(): Promise<(AgentTool)[]> {
        return [];
    }

    /**
     * Returns the commands that the plugin provides.
     * Commands are similar to Discord commands and are used to interact with the agent.
     * @returns Array of available commands
     */
    async getCommands(): Promise<AgentCommand[]> {
        return [];
    }
}

/** 
 * Represents the content of a command response.
 * Can be either user content or assistant content.
 */
export type CommandContent = {
    type: "user",
    content: ComplexMessageContent[]
} | {
    type: "assistant",
    content: ComplexMessageContent[]
}



/** 
 * Represents a system message that can be added by plugins.
 */
export type AgentSystemMessage = {
    content: ComplexMessageContent[]
}
