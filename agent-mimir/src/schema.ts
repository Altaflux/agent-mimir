import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { MimirAIMessage, NextMessage } from "./agent/base-agent.js";
import { AttributeDescriptor, ResponseFieldMapper } from "./agent/instruction-mapper.js";
import { StructuredTool } from "langchain/tools";
import { BaseLanguageModel } from "langchain/base_language";
import { BaseChatMemory } from "langchain/memory";
import { BaseChatMessageHistory, BaseMessage } from "langchain/schema";


export type AIMessageType = {
    thoughts?: string,
    reasoning?: string,
    saveToScratchPad?: string,
    currentPlanStep?: string,
    action: string,
    action_input: any,
    plan?: string[],
    mainGoal?: string,
    messageToUser?: string,
}

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
    talkToUserTool?: StructuredTool,
    plugins: MimirAgentPlugin[]
    constitution: string,
    workspaceManager: AgentWorkspace,
    resetFunction: () => Promise<void>,
    memoryBuilder: (messageHistory: {
        messageHistory: BaseChatMessageHistory,
        plainText: boolean,
    }) => BaseChatMemory,
}
export type PluginContext = {
    workingDirectory: string,
    persistenceDirectory: string,
    agentName: string,
}

export interface MimirPluginFactory {
    name: string;
    create(context: PluginContext): MimirAgentPlugin
}

export abstract class MimirAgentPlugin {

    init(): Promise<void> {
        return Promise.resolve();
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

    tools(): StructuredTool[] {
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
    functionReply?: {
        name: string,
        arguments: string,
    },
}

export type MemoryCompactionCallback = (newMessage: BaseMessage[], previousConversation: BaseMessage[]) => Promise<void>;

export type AgentUserMessage = {
    message: string,
    sharedFiles?: {
        url: string,
        fileName: string,
    }[],
}

export type AgentToolRequest = { toolName: string, toolArguments: string }

export type FunctionResponseCallBack = (name: string, input: string, response: string) => Promise<void>;