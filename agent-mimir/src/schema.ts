import { BaseChain } from "langchain/chains";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { MimirAIMessage, NextMessage } from "./agent/base-agent.js";
import { AttributeDescriptor, ResponseFieldMapper } from "./agent/instruction-mapper.js";
import { StructuredTool } from "langchain/tools";
import { BaseLanguageModel } from "langchain/base_language";
import { BaseChatMemory } from "langchain/memory";

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

export type Agent = { name: string, description: string, agent: BaseChain }

export type MimirAgentArgs = {
    name: string,
    description: string,
    llm: BaseLanguageModel,
    memory: BaseChatMemory
    taskCompleteCommandName: string,
    talkToUserTool: StructuredTool,
    plugins: MimirAgentPlugin[]
    constitution: string,
}

export abstract class MimirAgentPlugin {

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
}

export type AgentContext = {
    name: string,
    input: NextMessage,
};

export class LangchainToolWrapper extends MimirAgentPlugin {
    constructor(private tool: StructuredTool) {
        super();
    }

    tools(): StructuredTool[] {
        return [this.tool];
    }
}
