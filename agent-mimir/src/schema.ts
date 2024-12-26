
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { StateAnnotation } from "./agent-manager/index.js";
import { AgentTool } from "./tools/index.js";

export type ToolResponse = ComplexResponse[];
export type MessageContentToolUse = {
    name: string;
    input: Record<string, any>,
    id?: string,
}
export type MimirAiMessage = {
    content: ResponseContentText[]
    toolCalls: MessageContentToolUse[]
}

export const FILES_TO_SEND_FIELD = "filesToSend";

export type Agent = {
    name: string,
    description: string,
    call: <T extends boolean>(continuousMode: T, message: string | null, input: Record<string, any>, callback?: FunctionResponseCallBack) => T extends true ? Promise<AgentUserMessageResponse> : Promise<AgentResponse>,
    workspace: AgentWorkspace,
    reset: () => Promise<void>,
};

export class AgentToolRequestResponse implements AgentResponse {
    constructor(public output: AgentToolRequest) { }
    toolStep(): this is AgentToolRequestResponse {
        return true;
    }
    agentResponse(): this is AgentUserMessageResponse {
        return false;
    }
}
export class AgentUserMessageResponse implements AgentResponse {
    constructor(public output: AgentUserMessage) { }
    toolStep(): this is AgentToolRequestResponse {
        return false;
    }
    agentResponse(): this is AgentUserMessageResponse {
        return true;
    }
}
export interface AgentResponse {
    toolStep(): this is AgentToolRequestResponse,
    agentResponse(): this is AgentUserMessageResponse,
}

export type AgentWorkspace = {
    listFiles(): Promise<string[]>,
    loadFileToWorkspace(fileName: string, url: string): Promise<void>,
    reset(): Promise<void>,
    getUrlForFile(fileName: string): Promise<string | undefined>,
    fileAsBuffer(fileName: string): Promise<Buffer | undefined>,
    pluginDirectory(pluginName: string): Promise<string>,
    workingDirectory: string,
}

export type WorkspaceManagerFactory = (workkDirectory: string) => Promise<AgentWorkspace>;

export type MimirAgentArgs = {
    name: string,
    description: string,
    llm: BaseLanguageModel,
    taskCompleteCommandName: string,
    plugins: MimirAgentPlugin[]
    constitution: string,
    resetFunction: () => Promise<void>,
    checkpointer: BaseCheckpointSaver,
}
export type PluginContext = {
    workspace: AgentWorkspace,
    persistenceDirectory: string,
    agentName: string,
}

export interface MimirPluginFactory {
    name: string;
    create(context: PluginContext): MimirAgentPlugin
}

export type NextMessageUser = {
    type: "USER_MESSAGE",
    content: ComplexResponse[]
}

export type NextMessageToolResponse = {
    type: "ACTION",
    toolCallId: string,
    tool: string,
    content: ComplexResponse[]
}


export type ImageType = {
    url: string,
    type: SupportedImageTypes
}

export type SupportedImageTypes = "url" | "jpeg" | "png";

export type ResponseContentText = {
    type: "text";
    text: string;
};
export type ResponseContentImage = {
    type: "image_url";
    image_url: {
        url: string;
        type: SupportedImageTypes;
    };
};

export type ComplexResponse = ResponseContentText | ResponseContentImage

export type AdditionalContent = {
    saveToChatHistory: boolean,
    displayOnCurrentMessage: boolean,
    content: ComplexResponse[]
}

export type AgentContext = typeof StateAnnotation.State;

export abstract class MimirAgentPlugin {

    init(): Promise<void> {
        return Promise.resolve();
    }

    async readyToProceed(context: AgentContext): Promise<void> {
    }

    async additionalMessageContent(message: NextMessageUser, context: AgentContext): Promise<AdditionalContent[]> {
        return [];
    }

    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {
        return {
            content: []
        };
    }

    async readResponse(aiMessage: MimirAiMessage, context: AgentContext): Promise<void> {
    }

    async clear(): Promise<void> {
    }

    tools(): Promise<(AgentTool)[]> | (AgentTool)[] {
        return [];
    }
}

export type AgentUserMessage = {
    agentName?: string,
    message: string,
    sharedFiles?: {
        url: string,
        fileName: string,
    }[],
}

export type AgentToolRequest = { message: string | null, toolRequests: {toolName: string, toolArguments: string}[] }

export type FunctionResponseCallBack = (name: string, input: string, response: string) => Promise<void>;

export type AgentSystemMessage = {
    content: ComplexResponse[]
}
