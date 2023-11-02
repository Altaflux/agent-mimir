import { Embeddings } from "langchain/embeddings/base";
import { StructuredTool } from "langchain/tools";
import { VectorStore } from "langchain/vectorstores/base";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { z } from "zod";
import { Document } from 'langchain/document'
import { BaseChatModel } from "langchain/chat_models/base";
import { TAG_EXTRACTION_PROMPT, TAG_FINDER_PROMPT } from "./prompt.js";
import { AIMessageLLMOutputParser } from "../../agent/openai-function-agent.js";
import { MimirAIMessage } from "../../agent/base-agent.js";
import { LLMChain } from "langchain/chains";
import { BaseMessage } from "langchain/schema";
import { messagesToString } from "../../utils/format.js";

import path from "path";
import { promises as fs } from 'fs';

export class TagMemoryManager {

    vectorStore: VectorStore;
    relevantInformation: Map<string, string[]> = new Map<string, string[]>();
    model: BaseChatModel;
    persistencePath: string;

    constructor(embeddings: Embeddings, model: BaseChatModel, persistencePath: string) {
        this.vectorStore = new MemoryVectorStore(embeddings);
        this.model = model;
        this.persistencePath = persistencePath;
    }

    async init(): Promise<void> {
        await fs.mkdir(this.persistencePath, { recursive: true });
        const jsonFile = path.join(this.persistencePath, "tag-memory.json");
        const fileExists = await fs.access(jsonFile, fs.constants.F_OK).then(() => true).catch(() => false);
        if (fileExists) {
            const content: Map<string, string[]> = new Map(JSON.parse(await fs.readFile(jsonFile, 'utf-8')));
            this.relevantInformation = content;
            for (const tag of this.relevantInformation.keys()) {
                const document = new Document({ pageContent: tag });
                await this.vectorStore.addDocuments([document]);
            }
            console.log("Loaded tag memory from file.");
        }
    }

    async clear(): Promise<void> {
        this.relevantInformation = new Map<string, string[]>();
        this.vectorStore = new MemoryVectorStore(this.vectorStore.embeddings);
        await this.save();
    }

    private async save(): Promise<void> {
        const jsonFile = path.join(this.persistencePath, "tag-memory.json");
        await fs.writeFile(jsonFile, JSON.stringify(Array.from(this.relevantInformation.entries()), null, 2));
    }

    async extractConversationInformation(newMessages: BaseMessage[], previousConversation: BaseMessage[]): Promise<void> {

        const chain: LLMChain<MimirAIMessage> = new LLMChain({
            llm: this.model,
            prompt: TAG_EXTRACTION_PROMPT,
            outputParser: new AIMessageLLMOutputParser()
        });

        const messagesAsString = messagesToString(newMessages, "Human", "AI");
        const previousConversationAsString = messagesToString(previousConversation, "Human", "AI");
        const tags = this.getAllTags().map(s => `"${s}"`).join(",");

        const functionResponse = await chain.predict({ summary: previousConversationAsString, new_lines: messagesAsString, tools: [new TagTool()], memoryTags: tags });
        const relevantFacts: z.input<TagTool["schema"]> = JSON.parse(functionResponse.functionCall?.arguments ?? "");

        for (const relevantInformation of relevantFacts.relevantFacts) {
            for (const information of relevantInformation.fact) {
                await this.addTag([relevantInformation.topic], `${information}`);
            }
        }
        await this.save();
    }

    async findRelevantTags(currentBuffer: string, newMessages: string) {
        const chain: LLMChain<MimirAIMessage> = new LLMChain({
            llm: this.model,
            prompt: TAG_FINDER_PROMPT,
            outputParser: new AIMessageLLMOutputParser()
        });
        const tagTool = new TagFinderTool();
        const tags = this.getAllTags();
        if (tags.length === 0) {
            return [];
        }
        const functionResponse = await chain.predict({
            summary: currentBuffer,
            new_lines: newMessages,
            tools: [tagTool],
            memoryTags: tags.map(s => `"${s}"`).join(",")
        });
        const listOfRelevantTags: z.input<TagFinderTool["schema"]> = JSON.parse(functionResponse.functionCall?.arguments ?? "");
        return listOfRelevantTags.tagList;
    }

    private async addTag(tags: string[], information: string) {

        for (const tag of tags) {
            const document = new Document({ pageContent: tag });
            if (!(this.getAllTags().includes(tag))) {
                await this.vectorStore?.addDocuments([document]);
            }
            const previousMemories = this.relevantInformation.get(tag);
            if (previousMemories) {
                const memories = [...previousMemories, information];
                if (memories.length > 5) {
                    memories.shift();
                }
                this.relevantInformation.set(tag, memories);
            } else {
                this.relevantInformation.set(tag, [information]);
            }
        }
    }

    getAllTags() {
        return Array.from(this.relevantInformation.keys());
    }

    getAllRelevantInformation() {
        return this.relevantInformation;
    }

    async rememberTagFacts(tag: string) {
        const tagDocuments = await Promise.all([tag].map(async (tag) => {
            return await this.vectorStore.similaritySearch(tag, 1);
        }));

        const validTags = tagDocuments.flat()
            .filter((tag) => tag !== undefined)
            .map((tag) => tag!.pageContent);

        const relevtanInformation = Array.from(new Set(validTags)).map((tag) => {
            if (tag) {
                return this.relevantInformation.get(tag) ?? [];
            }
            return []
        }).flat();

        return relevtanInformation;
    }
}


class TagTool extends StructuredTool {

    schema = z.object({
        relevantFacts: z.array(z.object({
            fact: z.array(z.string().describe("A well detailed and complete summary of a fact of the topic.")).describe("A list of the relevant facts about the topic."),
            topic: z.string().describe("The main topic of the facts."),
        })).describe("A list of the relevant information to the main subject of the conversation."),
    });

    returnDirect: boolean = false;

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return "Success!";
    }

    name: string = "recordRelevantFacts";
    description: string = "Use to respond the list of relevant facts. Input should be a list of the relevant facts to the main subject of the conversation. ";
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
