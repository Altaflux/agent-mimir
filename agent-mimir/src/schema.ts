import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { MimirAIMessage } from "./agent/base-agent.js";
import { AttributeDescriptor, ResponseFieldMapper } from "./agent/instruction-mapper.js";
import { BaseLanguageModel } from "langchain/base_language";
import { BaseChatMemory } from "langchain/memory";
import { BaseChatMessageHistory, BaseMessage, ChainValues, MessageContent } from "langchain/schema";
import { AgentTool } from "./tools/index.js";


export const FILES_TO_SEND_FIELD = "filesToSend";

export type Agent = {
    name: string,
    description: string,
    call: <T extends boolean>(continuousMode: T, input: Record<string, any>, callback?: FunctionResponseCallBack) => T extends true ? Promise<AgentUserMessageResponse> : Promise<AgentResponse>,
    workspace: AgentWorkspace,
    reset: () => Promise<void>,
};


export interface AgentUserMessageResponse extends AgentResponse {
    output: AgentUserMessage
}
export interface AgentToolRequestResponse extends AgentResponse {
    output: AgentToolRequest
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
    pluginDirectory(pluginName: string): string,
    workingDirectory: string,
}

export type WorkspaceManagerFactory = (workkDirectory: string) => Promise<AgentWorkspace>;

export type MimirAgentArgs = {
    name: string,
    description: string,
    llm: BaseLanguageModel,
    chatMemory: BaseChatMessageHistory
    taskCompleteCommandName: string,
    imageHandler: LLMImageHandler
    talkToUserTool?: AgentTool,
    plugins: MimirAgentPlugin[]
    constitution: string,
    resetFunction: () => Promise<void>,
    memoryBuilder: (messageHistory: {
        messageHistory: BaseChatMessageHistory,
        plainText: boolean,
    }) => BaseChatMemory,
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


export type LLMImageHandler = (images: ImageType[], detail: "high" | "low") => Extract<MessageContent, (
    | {
        type: "text";
        text: string;
    }
    | {
        type: "image_url";
        image_url: string | { url: string; detail?: "auto" | "low" | "high" };
    }
)[]>;

export type NextMessage = {
    type: "ACTION" | "USER_MESSAGE",
    message: string,
    image_url?: {
        url: string,
        type: SupportedImageTypes
    }[],
    tool?: string,
}

export type ImageType = {
    url: string,
    type: SupportedImageTypes
}

export type SupportedImageTypes = "url" | "jpeg" | "png";
export type ToolResponse = {
    text?: string,
    image_url?: ImageType[],
}

export abstract class MimirAgentPlugin {

    init(): Promise<void> {
        return Promise.resolve();
    }

    async processMessage(message: NextMessage, inputs: ChainValues): Promise<NextMessage | undefined> {
        return message;
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [];
    }

    async readResponse(context: AgentContext, aiMessage: MimirAIMessage, responseFieldMapper: ResponseFieldMapper): Promise<void> {
    }

    async clear(): Promise<void> {
    }

    async getInputs(context: AgentContext): Promise<Record<string, any>> {
        return {};
    }

    attributes(): AttributeDescriptor[] {
        return [];
    }

    tools(): Promise<(AgentTool)[]> | (AgentTool)[] {
        return [];
    }

    async memoryCompactionCallback(newLines: BaseMessage[], previousConversation: BaseMessage[]): Promise<void> {

    }
}

export type AgentContext = {
    input: NextMessage,
    memory?: BaseChatMemory,
};

export type MimirHumanReplyMessage = {
    type: "USER_MESSAGE" | "FUNCTION_REPLY",
    message?: string,
    image_url?: ImageType[],
    functionReply?: {
        name: string,
        arguments: string,
    },
}

export type MemoryCompactionCallback = (newMessage: BaseMessage[], previousConversation: BaseMessage[]) => Promise<void>;

export type AgentUserMessage = {
    agentName?: string,
    message: string,
    sharedFiles?: {
        url: string,
        fileName: string,
    }[],
}

export type AgentToolRequest = { toolName: string, toolArguments: string }

export type FunctionResponseCallBack = (name: string, input: string, response: string) => Promise<void>;