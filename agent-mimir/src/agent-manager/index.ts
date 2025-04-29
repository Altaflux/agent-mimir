import { AgentCommand } from "../plugins/index.js";
import { ComplexMessageContent } from "../schema.js";
export { AgentFactory, AgentConfig } from "./factory.js";
/**
 * Represents a tool use request from an agent.
 * Contains information about which tool to use and its input parameters.
 */
export type MessageContentToolUse = {
    /** The name of the tool to be executed */
    toolName: string;
    /** Input parameters for the tool as key-value pairs */
    input: string,
    /** Optional unique identifier for this tool use request */
    id?: string,
}
/**
 * Represents a message from an agent that includes tool use requests.
 * Extends InputAgentMessage to include an array of tool calls.
 */
export type AgentMessageToolRequest = { toolCalls: MessageContentToolUse[] } & OutputAgentMessage;

export type OutputAgentMessage = {id: string} & InputAgentMessage
/**
 * Represents an input message to an agent.
 * Contains the message content and optional shared files.
 */
export type InputAgentMessage = {
    /** Array of complex message content (can include text, images, etc.) */
    content: ComplexMessageContent[],
    /** Optional array of shared files with their URLs and names */
    sharedFiles?: SharedFile[]
};

export type SharedFile = {
        /** URL where the file can be accessed */
        url: string,
        /** Name of the file */
        fileName: string,
}

/**
 * Factory function type for creating agent workspaces.
 * Takes a working directory path and returns a Promise that resolves to an AgentWorkspace.
 */
export type WorkspaceFactory = (workDirectory: string) => Promise<AgentWorkspace>;



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
        threadId: string,
        noMessagesInTool?: boolean
    }) => AsyncGenerator<IntermediateAgentMessage, {
        message: AgentResponse,
        checkpointId: string,
    }, unknown>,
    /**
     * Processes specific commands sent to the agent.
     * @param args.command - The command request to handle
     * @returns AsyncGenerator yielding tool responses and final agent response
     */
    handleCommand: (args: {
        command: CommandRequest,
        threadId: string
    }) => AsyncGenerator<IntermediateAgentMessage, {
        message: AgentResponse,
        checkpointId: string
    }, unknown>,
    /** The agent's workspace for file operations */
    workspace: AgentWorkspace,
    /** Array of commands available to this agent */
    commands: AgentCommand[],
    /** Resets the agent's state */
    reset: (args: {
        threadId: string,
        checkpointId?: string
    }) => Promise<void>,
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
    responseAttributes: Record<string, string>
}

/**
 * Represents a response from an agent directed to a user.
 */
export type AgentUserMessageResponse = {
   // id: string,
    /** Identifies this as an agent response */
    type: "agentResponse",
    /** The message content */
    output: OutputAgentMessage, //TODO THIS IS MISSING AND ID
    /** Additional attributes for the response */
    responseAttributes: Record<string, string>
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

export type IntermediateAgentMessage = {
    type: "toolResponse",
    toolResponse: ToolResponseInfo
} | {
    type: "messageChunk",
    chunk: {
        id: string,
        content: ComplexMessageContent[]
    }
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
    /** The current working directory path */
    workingDirectory: string,
    /** The root directory path of the workspace */
    rootDirectory: string,
}
