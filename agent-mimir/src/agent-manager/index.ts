import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentCommand, PluginFactory } from "../plugins/index.js";
import { ComplexMessageContent } from "../schema.js";
import { Tool } from "@langchain/core/tools";


/**
 * Represents a tool use request from an agent.
 * Contains information about which tool to use and its input parameters.
 */
export type MessageContentToolUse = {
    /** The name of the tool to be executed */
    toolName: string;
    /** Input parameters for the tool as key-value pairs */
    input: Record<string, any>,
    /** Optional unique identifier for this tool use request */
    id?: string,
}
/**
 * Represents a message from an agent that includes tool use requests.
 * Extends InputAgentMessage to include an array of tool calls.
 */
export type AgentMessageToolRequest = { toolCalls: MessageContentToolUse[] } & InputAgentMessage;

/**
 * Represents an input message to an agent.
 * Contains the message content and optional shared files.
 */
export type InputAgentMessage = {
    /** Array of complex message content (can include text, images, etc.) */
    content: ComplexMessageContent[],
    /** Optional array of shared files with their URLs and names */
    sharedFiles?: {
        /** URL where the file can be accessed */
        url: string,
        /** Name of the file */
        fileName: string,
    }[]
};

/**
 * Represents a message that can be directed to a specific agent.
 * Extends InputAgentMessage to include an optional destination agent.
 */
export type AgentMessage = { 
    /** Optional name of the agent this message should be sent to */
    destinationAgent?: string 
} & InputAgentMessage

/**
 * Factory function type for creating agent workspaces.
 * Takes a working directory path and returns a Promise that resolves to an AgentWorkspace.
 */
export type WorkspaceFactory = (workDirectory: string) => Promise<AgentWorkspace>;

/**
 * Configuration options for creating a new agent.
 * Contains all necessary parameters to initialize an agent with its capabilities.
 */
export type CreateAgentArgs = {
    /** The professional role or expertise of the agent */
    profession: string,
    /** A description of the agent's purpose and capabilities */
    description: string,
    /** The unique name identifier for the agent */
    name: string,
    /** The language model to be used by the agent */
    model: BaseChatModel,
    /** Optional array of plugin factories to extend agent functionality */
    plugins?: PluginFactory[],
    /** Optional constitution defining agent behavior guidelines */
    constitution?: string,
    /** Optional vision support type (currently only supports 'openai') */
    visionSupport?: 'openai',
    /** Factory function to create the agent's workspace */
    workspaceFactory: WorkspaceFactory,
}



/**
 * Core interface defining an agent's structure and capabilities.
 * Represents a single agent instance with its properties and methods.
 */
export interface Agent {
    /** Unique name identifier for the agent */
    name: string,
    /** Description of the agent's purpose and capabilities */
    description: string,
    /**
     * Primary method for interacting with the agent.
     * Processes input messages and generates responses or tool requests.
     * @param args.message - The input message to process, can be null
     * @param args.noMessagesInTool - Optional flag to prevent message processing in tools
     * @returns AsyncGenerator yielding tool responses and final agent response
     */
    call: (args: {
        message: InputAgentMessage | null,
        noMessagesInTool?: boolean
    }) => AsyncGenerator<ToolResponseInfo, AgentResponse, unknown>,
    /**
     * Processes specific commands sent to the agent.
     * @param args.command - The command request to handle
     * @returns AsyncGenerator yielding tool responses and final agent response
     */
    handleCommand: (args: {
        command: CommandRequest
    }) => AsyncGenerator<ToolResponseInfo, AgentResponse, unknown>,
    /** The agent's workspace for file operations */
    workspace: AgentWorkspace,
    /** Array of commands available to this agent */
    commands: AgentCommand[],
    /** Resets the agent's state */
    reset: () => Promise<void>,
};



/**
 * Represents a response from an agent requesting to use a tool.
 */
export type AgentToolRequestResponse = {
    /** Identifies this as a tool request response */
    type: "toolRequest",
    /** The tool request message */
    output: AgentMessageToolRequest,
    /** Additional attributes for the response */
    responseAttributes: Record<string, any>
}

/**
 * Represents a response from an agent directed to a user.
 */
export type AgentUserMessageResponse = {
    /** Identifies this as an agent response */
    type: "agentResponse",
    /** The message content */
    output: AgentMessage,
    /** Additional attributes for the response */
    responseAttributes: Record<string, any>
}

/**
 * Union type representing all possible agent response types.
 */
export type AgentResponse = AgentToolRequestResponse | AgentUserMessageResponse;

/**
 * Represents a command request that can be sent to an agent.
 */
export type CommandRequest = {
    /** Name of the command to execute */
    name: string,
    /** Optional arguments for the command */
    arguments?: Record<string, any>
}

/**
 * Information about a tool's response after execution.
 */
export type ToolResponseInfo = { 
    /** Optional unique identifier for the tool response */
    id?: string, 
    /** Name of the tool that was executed */
    name: string, 
    /** Array of complex message content representing the tool's response */
    response: ComplexMessageContent[] 
}


/**
 * Defines the workspace interface for an agent, providing file system operations
 * and directory management capabilities.
 */
export type AgentWorkspace = {
    /** Lists all files in the workspace */
    listFiles(): Promise<string[]>,
    /** Loads a file into the workspace from a URL */
    loadFileToWorkspace(fileName: string, url: string): Promise<void>,
    /** Resets the workspace to its initial state */
    reset(): Promise<void>,
    /** Gets the URL for a file in the workspace */
    getUrlForFile(fileName: string): Promise<string | undefined>,
    /** Gets a file's contents as a Buffer */
    fileAsBuffer(fileName: string): Promise<Buffer | undefined>,
    /** Gets the directory path for a plugin */
    pluginDirectory(pluginName: string): Promise<string>,
    /** The current working directory path */
    workingDirectory: string,
    /** The root directory path of the workspace */
    rootDirectory: string,
}
