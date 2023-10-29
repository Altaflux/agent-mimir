import { BaseMessage } from "langchain/schema";
import { StructuredTool } from "langchain/tools";
import { AgentContext, MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../../schema.js";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { TagMemoryManager } from "./index.js";
import { z } from "zod";
import { messagesToString } from "../../utils/format.js";
import { Embeddings } from "langchain/embeddings";
import { BaseChatModel } from "langchain/chat_models";

export class ManualTagMemoryPluginFactory implements MimirPluginFactory {

    name: string = "manualTagMemory";

    constructor(private embeddings: Embeddings, private model: BaseChatModel) {
    }

    create(context: PluginContext): MimirAgentPlugin {
        return new ManualTagMemoryPlugin(this.embeddings, this.model, context.persistenceDirectory);
    }
}

export class ManualTagMemoryPlugin extends MimirAgentPlugin {

    private manager: TagMemoryManager;

    constructor(embeddings: Embeddings, model: BaseChatModel, persistencePath: string) {
        super();
        this.manager = new TagMemoryManager(embeddings, model, persistencePath);
    }

        
    async init(): Promise<void> {
        await this.manager.init();
    }

    async clear(): Promise<void> {
        await this.manager.clear();
    }

    async memoryCompactionCallback(newLines: BaseMessage[], previousConversation: BaseMessage[]): Promise<void> {
        await this.manager.extractConversationInformation(newLines, previousConversation);
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(`You can recall memories by using the following tags and the "recallMemories" function: {memoryTags}\n`),
        ];
    }

    async getInputs(_: AgentContext): Promise<Record<string, any>> {
        return {
            memoryTags: this.manager.getAllTags().map(tag => `"${tag}"`).join(", ")
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
        const memoriesByTag = await Promise.all(arg.relevantInformation.slice(0, 3).map(async (tag) => {
            const memories = await this.manager.rememberTagFacts(tag);
            return `Topic or context: ${tag}\n-${memories.join("\n-")}`
        }));
        return `You remember the following information: ${memoriesByTag.join("\n\n")}`;
    }

    name: string = "recallMemories";
    description: string = "Use to request a list of relevant topics. Input should be a list of memory tags.";

}


export class AutomaticTagMemoryPluginFactory implements MimirPluginFactory {

    name: string = "automaticTagMemory";

    constructor(private embeddings: Embeddings, private model: BaseChatModel) {
    }

    create(context: PluginContext): MimirAgentPlugin {
        return new AutomaticTagMemoryPlugin(this.embeddings, this.model, context.persistenceDirectory);
    }
}

export class AutomaticTagMemoryPlugin extends MimirAgentPlugin {

    private tagManager: TagMemoryManager;

    constructor(embeddings: Embeddings, model: BaseChatModel, persistencePath: string) {
        super();
        this.tagManager = new TagMemoryManager(embeddings, model, persistencePath);
    }

    async init(): Promise<void> {
        await this.tagManager.init();
    }

    async clear(): Promise<void> {
        await this.tagManager.clear();
    }

    async memoryCompactionCallback(newLines: BaseMessage[], previousConversation: BaseMessage[]): Promise<void> {
        await this.tagManager.extractConversationInformation(newLines, previousConversation);
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
        const messages = memoryVariables[context.memory.memoryKeys[0] ?? ""];
        if (this.tagManager.getAllTags().length === 0) {
            return {
                recalledMemories: "No memories yet.",
            };
        }
        const formattedMessages = context.memory.returnMessages ? messagesToString(messages as BaseMessage[], "AI", "Human") : messages as string;
        const relevantTags = (await this.tagManager.findRelevantTags(formattedMessages, context.input.message)).slice(0, 3);

        const memoriesByTag = await Promise.all(relevantTags.map(async (tag) => {
            const memories = await this.tagManager.rememberTagFacts(tag);
            return `Topic or context: ${tag}\n-${memories.join("\n-")}`
        }));

        const memories = memoriesByTag.join("\n\n");
        return {
            recalledMemories: memories
        };
    }

}