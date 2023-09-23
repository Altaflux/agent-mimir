
import { BaseMessage } from "langchain/schema";
import { StructuredTool } from "langchain/tools";
import { AgentContext, MimirAgentPlugin } from "../../schema.js";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { TagMemoryManager } from "./index.js";
import { z } from "zod";
import { messagesToString } from "../../utils/format.js";

export class ManualTagMemoryPlugin extends MimirAgentPlugin {

    constructor(private manager: TagMemoryManager) {
        super();
    }

    async memoryCompactionCallback(newLines: BaseMessage[], previousConversation: BaseMessage[]): Promise<void> {
        await this.manager.getCallback(newLines, previousConversation);
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(`You can recall memories by using the following tags and the "recallMemories" function: {memoryTags}\n`),
        ];
    }

    async getInputs(_: AgentContext): Promise<Record<string, any>> {
        return {
            memoryTags: (await this.manager.getTags()).map(tag => `"${tag}"`).join(", ")
        };
    }

    tools(): StructuredTool[] {

        return [new TagRetrieverTool(this.manager)];
    }

}


class TagRetrieverTool extends StructuredTool {

    constructor(private manager: TagMemoryManager) {
        super();
    }

    schema = z.object({
        relevantInformation: z.array(z.string().describe("a tag")).describe("A list of the of the tags you want to retrieve their memories."),
    });

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {

        const memoriesByTag = await Promise.all(arg.relevantInformation.map(async (tag) => {
            const memories = await this.manager.remember(tag);
            return memories.join(`Context for memories: ${tag}\n-${memories.join("\n-")}}`);
        }));
        return `You remember the following information: ${memoriesByTag.join("\n\n")}`;
    }

    name: string = "recallMemories";
    description: string = "Use to request a list of relevant information. Input should be a list of memory tags.";

}



export class AutomaticTagMemoryPlugin extends MimirAgentPlugin {
    constructor(private manager: TagMemoryManager) {
        super();
    }

    async memoryCompactionCallback(newLines: BaseMessage[], previousConversation: BaseMessage[]): Promise<void> {
        await this.manager.getCallback(newLines, previousConversation);
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(`You remember the following information:\n {recalledMemories}\n`),
        ];
    }

    async getInputs(context: AgentContext): Promise<Record<string, any>> {
        if (!context.memory) {
            throw new Error("No memory found in agent.");
        }
        const memoryVariables = await context.memory.loadMemoryVariables({});
        const messages = memoryVariables[context.memory.memoryKeys[0] ?? ""];//Aqui content es un JSON
        const formattedMessages = context.memory.returnMessages ? messagesToString(messages as BaseMessage[], "AI", "Human") : messages as string;
        const memories = await this.manager.getMemories(formattedMessages, context.input.message);
        return {
            recalledMemories: memories
        };
    }

}