
import { AgentContext, AgentSystemMessage, MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../../schema.js";
import { TagMemoryManager } from "./index.js";
import { z } from "zod";
import { extractAllTextFromComplexResponse, messagesToString } from "../../utils/format.js";

import { LangchainToolToMimirTool } from "../../utils/wrapper.js";
import { AgentTool } from "../../tools/index.js";
import { StructuredTool } from "@langchain/core/tools";
import { BaseMessage } from "@langchain/core/messages";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export class ManualTagMemoryPluginFactory implements MimirPluginFactory {

    name: string = "manualTagMemory";

    constructor(private embeddings: Embeddings, private model: BaseChatModel) {
    }

    create(context: PluginContext): MimirAgentPlugin {
        return (new ManualTagMemoryPlugin(this.embeddings, this.model, context.persistenceDirectory));
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

    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {
        const memoryTags = this.manager.getAllTags().map(tag => `"${tag}"`).join(", ");
        return {
            content: [
                {
                    type: "text",
                    text: `You can recall memories by using the following tags and the "recallMemories" function: ${memoryTags}\n`
                }
            ]
        }
    }

    tools(): AgentTool[] {
        return [new LangchainToolToMimirTool(new TagRetrieverTool(this.manager))];
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

        const memoriesByTagList = (await Promise.all(arg.relevantInformation.slice(0, 3).map(async (tag) => {
            return await this.manager.rememberTagFacts(tag);
        }))).flat().filter((value, index, self) => {
            return self.findIndex((v) => v.tag === value.tag) === index;
        });

        const memoriesByTag = memoriesByTagList.map(tag => {
            return `Topic or context: ${tag.tag}\n-${tag.facts.join("\n-")}`
        });

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

class AutomaticTagMemoryPlugin extends MimirAgentPlugin {

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

    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {

        if (!context.memory) {
            throw new Error("No memory found in agent.");
        }
        if (context.input.type !== "USER_MESSAGE") {
            return {
                content: []
            }
        }

        const memoryVariables = await context.memory.loadMemoryVariables({});
        const messages = memoryVariables[context.memory.memoryKeys[0] ?? ""];
        if (this.tagManager.getAllTags().length === 0) {

            return {
                content: [
                    {
                        type: "text",
                        text: "No memories yet."
                    }
                ]
            }
        }
        const formattedMessages = context.memory.returnMessages ? messagesToString(messages as BaseMessage[], "AI", "Human") : messages as string;
        const relevantTags = (await this.tagManager.findRelevantTags(formattedMessages, extractAllTextFromComplexResponse(context.input.content))).slice(0, 3);

        const memoriesByTagList = (await Promise.all(relevantTags.map(async (tag) => {
            return await this.tagManager.rememberTagFacts(tag);
        }))).flat()
            .filter((value, index, self) => {
                return self.findIndex((v) => v.tag === value.tag) === index;
            });

        const memoriesByTag = memoriesByTagList.map(tag => {
            return `Topic or context: ${tag.tag}\n-${tag.facts.join("\n-")}`
        });

        const memories = memoriesByTag.join("\n\n");

        return {
            content: [
                {
                    type: "text",
                    text: `You remember the following information:\n ${memories}\n`
                }
            ]
        }
    }


}