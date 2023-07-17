import { BaseChain } from "langchain/chains";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { BaseOutputParser } from "langchain/schema/output_parser";
import { MimirAIMessage } from "./agent/base-agent.js";
import { AttributeDescriptor, ResponseFieldMapper } from "./agent/instruction-mapper.js";
import { StructuredTool } from "langchain/tools";

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

export abstract class AIMessageSerializer extends BaseOutputParser<string> {
    abstract serialize(message: AIMessageType): Promise<string>;
    abstract deserialize(text: string): Promise<AIMessageType>;

    async parse(text: string): Promise<string> {
        return JSON.stringify(await this.deserialize(text));
    }
}


export type Agent = { name: string, description: string, agent: BaseChain }



export abstract class MimirAgentPlugin {

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [];
    }

    async readResponse(aiMessage: MimirAIMessage, responseFieldMapper: ResponseFieldMapper): Promise<void> {
    }

    async clear(): Promise<void> {
    }

    async getInputs(): Promise<Record<string, any>> {
        return {};
    }

    attributes(): AttributeDescriptor[] {
        return [];
    }

    tools(): StructuredTool[] {
        return [];
    }
}

export class LangchainToolWrapper extends MimirAgentPlugin {
    constructor(private tool: StructuredTool) {
        super();
    }

    tools(): StructuredTool[] {
        return [this.tool];
    }
}
