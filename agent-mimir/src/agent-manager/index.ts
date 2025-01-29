import { AgentCommand } from "../plugins/index.js";
import { ComplexMessageContent } from "../schema.js";


export type MessageContentToolUse = {
    toolName: string;
    input: Record<string, any>,
    id?: string,
}
export type AgentMessageToolRequest = { toolCalls: MessageContentToolUse[] } & InputAgentMessage;

export type InputAgentMessage = {
    content: ComplexMessageContent[],
    sharedFiles?: {
        url: string,
        fileName: string,
    }[]
};

export type AgentMessage = { destinationAgent?: string } & InputAgentMessage
export type WorkspaceFactory = (workDirectory: string) => Promise<AgentWorkspace>;



export interface Agent {
    name: string,
    description: string,
    call: (args: {
        message: InputAgentMessage | null, 
        requestAttributes?: Record<string, any>, 
        noMessagesInTool?: boolean
    }) => AsyncGenerator<ToolResponseInfo, AgentResponse, unknown>,
    handleCommand: (args: {
        command: CommandRequest
    }) => AsyncGenerator<ToolResponseInfo, AgentResponse, unknown>,
    workspace: AgentWorkspace,
    commands: AgentCommand[],
    reset: () => Promise<void>,
};



export type AgentToolRequestResponse = {
    type: "toolRequest",
    output: AgentMessageToolRequest,
    responseAttributes: Record<string, any>
}

export type AgentUserMessageResponse = {
    type: "agentResponse",
    output: AgentMessage,
    responseAttributes: Record<string, any>
}
export type AgentResponse = AgentToolRequestResponse | AgentUserMessageResponse;


export type CommandRequest = {
    name: string,
    arguments?: Record<string, any>
}
export type ToolResponseInfo = { id?: string, name: string, response: ComplexMessageContent[] }


export type AgentWorkspace = {
    listFiles(): Promise<string[]>,
    loadFileToWorkspace(fileName: string, url: string): Promise<void>,
    reset(): Promise<void>,
    getUrlForFile(fileName: string): Promise<string | undefined>,
    fileAsBuffer(fileName: string): Promise<Buffer | undefined>,
    pluginDirectory(pluginName: string): Promise<string>,
    workingDirectory: string,
    rootDirectory: string,
}