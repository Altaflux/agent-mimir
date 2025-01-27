import { StateAnnotation } from "../agent-manager/agent.js";
import { AgentMessageToolRequest, AgentWorkspace, InputAgentMessage } from "../agent-manager/index.js";
import { ComplexResponse } from "../schema.js";
import { AgentTool } from "../tools/index.js";

export type AiResponseMessage = AgentMessageToolRequest;

export type AttributeDescriptor = {
    name: string,
    attributeType: string,
    variableName: string,
    description: string,
    example?: string,
}

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


export type PluginContext = {
    workspace: AgentWorkspace,
    persistenceDirectory: string,
    agentName: string,
}

export interface MimirPluginFactory {
    name: string;
    create(context: PluginContext): Promise<MimirAgentPlugin>
}

export type NextMessage = NextMessageUser | NextMessageToolResponse;
export  type NextMessageUser = InputAgentMessage & {type: "USER_MESSAGE"}

export type NextMessageToolResponse = {
    type: "TOOL_RESPONSE",
    toolCallId: string,
    toolName: string,
    content: ComplexResponse[]
}




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

    async readyToProceed(nextMessage: NextMessage, context: AgentContext): Promise<void> {
    }

    async additionalMessageContent(message: InputAgentMessage, context: AgentContext): Promise<AdditionalContent[]> {
        return [];
    }

    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {
        return {
            content: []
        };
    }

    async readResponse(aiMessage: AiResponseMessage, context: AgentContext, responseAttributes: Record<string, any>): Promise<Record<string, any>> {
        return {}
    }

    async clear(): Promise<void> {
    }

    async attributes(context: AgentContext): Promise<AttributeDescriptor[]> {
        return [];
    }

    tools(): Promise<(AgentTool)[]> | (AgentTool)[] {
        return [];
    }

    async getCommands(): Promise<AgentCommand[]> {
        return [];
    }
}

export type CommandContent = {
    type: "user",
    content: ComplexResponse[]
} | {
    type: "assistant",
    content: ComplexResponse[]
}



export type AgentSystemMessage = {
    content: ComplexResponse[]
}
