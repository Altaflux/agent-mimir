
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { MimirAIMessage } from "./agent/base-agent.js";
import { AttributeDescriptor, ResponseFieldMapper } from "./agent/instruction-mapper.js";
import { AgentTool } from "./tools/index.js";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";
import { BaseChatMemory } from "langchain/memory";
import { BaseMessage, MessageContentImageUrl } from "@langchain/core/messages";
import { ChainValues } from "@langchain/core/utils/types";


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

export type LLMImageHandler = (images: ImageType, detail: "high" | "low") =>  MessageContentImageUrl;


export type NextMessage = {
    type: "ACTION",
    tool: string,
    jsonPayload: string
} | {
    type: "USER_MESSAGE",
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
    image_url:  {
        url: string;
        type: SupportedImageTypes;
    };
};

export type ComplexResponse = ResponseContentText | ResponseContentImage
export type ToolResponse = ComplexResponse[];


export abstract class MimirAgentPlugin {

    init(): Promise<void> {
        return Promise.resolve();
    }

    async processMessage(message: NextMessage, inputs: ChainValues): Promise<NextMessage | undefined> {
        return message;
    }

    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {
        return {
            content: []
        };
    }

    async readResponse(context: AgentContext, aiMessage: MimirAIMessage, responseFieldMapper: ResponseFieldMapper): Promise<void> {
    }

    async clear(): Promise<void> {
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
    type: "USER_MESSAGE",
    content:  ComplexResponse[],
} | {
    type: "FUNCTION_REPLY",

    functionReply?: {
        name: string,
        arguments: ComplexResponse[],
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


type ImageDetail = "auto" | "low" | "high";

export type AgentMessageContentText = {
    type: "text";
    text: string;
};
export type AgentMessageContentImageUrl = {
    type: "image_url";
    image_url: string | {
        url: string;
        detail?: ImageDetail;
    };
};
export type AgentMessageContent = AgentMessageContentText | AgentMessageContentImageUrl;
export type AgentSystemMessage = {
    content: AgentMessageContent[]
}
