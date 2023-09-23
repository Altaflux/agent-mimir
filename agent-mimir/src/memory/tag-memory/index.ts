import { Embeddings } from "langchain/embeddings";
import { StructuredTool } from "langchain/tools";
import { VectorStore } from "langchain/vectorstores";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { z } from "zod";
import { Document } from 'langchain/document'
import { BaseChatModel } from "langchain/chat_models";
import { TAG_EXTRACTION_PROMPT, TAG_FINDER_PROMPT } from "./prompt.js";
import { AIMessageLLMOutputParser } from "../../agent/openai-function-agent.js";
import { MimirAIMessage } from "../../agent/base-agent.js";
import { LLMChain } from "langchain/chains";
import { BaseMessage } from "langchain/schema";
import { messagesToString } from "../../utils/format.js";

export class TagMemoryManager {

    vectorStore?: VectorStore;
    tags: Set<string> = new Set<string>();
    relevantInformation: Map<string, string[]> = new Map<string, string[]>();
    model: BaseChatModel;

    constructor(embeddings: Embeddings, model: BaseChatModel) {
        this.vectorStore = new MemoryVectorStore(embeddings);
        this.model = model;
    }


    async getCallback(newMessages: BaseMessage[], previousConversation: BaseMessage[]): Promise<void> {

        const chain: LLMChain<MimirAIMessage> = new LLMChain({
            llm: this.model,
            prompt: TAG_EXTRACTION_PROMPT,
            outputParser: new AIMessageLLMOutputParser()
        });

        const messagesAsString = messagesToString(newMessages, "Human", "AI"); //Aqui los mensajes son JSON tambien, solo veo los de AI y Human
        const previousConversationAsString = messagesToString(previousConversation, "Human", "AI"); //Aqui los mensajes son JSON tambien, solo veo los de AI y Human
        const functionResponse = await chain.predict({ summary: previousConversationAsString, new_lines: messagesAsString, tools: [new TagTool()] });
        const functionArguments: z.input<TagTool["schema"]> = JSON.parse(functionResponse.functionCall?.arguments ?? "");

        for (const relevantInformation of functionArguments.relevantInformation) {
            for (const information of relevantInformation.information) {
                await this.addTag([relevantInformation.topic], `${information}`);
            }
        }
    }

    async getMemories(currentBuffer: string, newMessages: string) {
        const chain: LLMChain<MimirAIMessage> = new LLMChain({
            llm: this.model,
            prompt: TAG_FINDER_PROMPT,
            outputParser: new AIMessageLLMOutputParser()
        });
        const tagTool = new TagFinderTool();
        const tags = await this.getTags();
        if (tags.length === 0) {
            return "";
        }
        const functionResponse = await chain.predict({
            summary: currentBuffer,
            new_lines: newMessages,
            tools: [tagTool],
            memoryTags: tags.map(s => `"${s}"`).join(",")
        });
        const functionArguments: z.input<TagFinderTool["schema"]> = JSON.parse(functionResponse.functionCall?.arguments ?? "");
        const memoriesByTag = await Promise.all(functionArguments.tagList.map(async (tag) => {
            const memories = await this.remember(tag);
            return memories.join(`Context for memories: ${tag}\n-${memories.join("\n-")}}`);
        }));
        return memoriesByTag.join("\n\n");
    }

    async addTag(tags: string[], information: string) {
        for (let i = 0; i < tags.length; i++) {
            const tag = tags[i];
            const document = new Document({
                pageContent: tag,
                metadata: [],
            });

            this.tags.add(tag);
            await this.vectorStore?.addDocuments([document]);
            const previousMemories = this.relevantInformation.get(tag);
            if (previousMemories) {
                this.relevantInformation.set(tag, [...previousMemories, information]);
            } else {
                this.relevantInformation.set(tag, [information]);
            }
        }

    }

    async getTags() {
        return Array.from(this.tags);
    }

    async remember(tags: string) {
        const allTags = await Promise.all([tags].map(async (tag) => {
            return await this.vectorStore?.similaritySearch(tag, 1);
        }));
        const onlyTags = allTags.flat()
            .filter((tag) => tag !== undefined)
            .map((tag) => tag!.pageContent);

        const relevtanInformation = Array.from(new Set(onlyTags)).map((tag) => {
            if (tag) {
                return this.relevantInformation.get(tag) ?? [];
            }
            return []
        }).flat();

        return relevtanInformation;
    }
}


class TagTool extends StructuredTool {

    constructor() {
        super();
    }

    schema = z.object({
        relevantInformation: z.array(z.object({
            information: z.array(z.string().describe("A well detailed and complete summary of an aspect of the topic.")).describe("A list of the relevant information about the topic."),
            topic: z.string().describe("The topic of the information."),
            context: z.string().describe("Context describing the source of this information."),

        })).describe("A list of the relevant information to the main subject of the conversation."),
    });

    returnDirect: boolean = false;

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return "Success!";
    }

    name: string = "recordRelevantInformation";
    description: string = "Use to respond the list of relevant information to the user. Input should be a list of the relevant information to the main subject of the conversation. ";
}
class TagFinderTool extends StructuredTool {

    constructor() {
        super();
    }

    schema = z.object({
        tagList: z.array(z.string().describe("a tag from the list of tags")).describe("A list of the relevant information to the main subject of the conversation. If there is no relevant information related to the new lines of conversations return an empty array response."),
    });

    returnDirect: boolean = false;

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return "Success!";
    }

    name: string = "selectRelevantTags";
    description: string = "Use this to return the list of relevant tags.";
}