
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { z } from "zod";
import { Document } from 'langchain/document'

import { TAG_EXTRACTION_PROMPT, TAG_FINDER_PROMPT } from "./prompt.js";
import { LLMChain } from "langchain/chains";
import { messagesToString } from "../../utils/format.js";
import { JsonSchema7ObjectType } from "zod-to-json-schema";
import { zodToJsonSchema } from "zod-to-json-schema";
import path from "path";
import { promises as fs } from 'fs';
import { callJsonRepair } from "../../utils/json.js";
import { BaseMessage } from "@langchain/core/messages";
import { VectorStore } from "@langchain/core/vectorstores";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Embeddings } from "@langchain/core/embeddings";

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

        const chain: LLMChain<string> = new LLMChain({
            llm: this.model,
            prompt: TAG_EXTRACTION_PROMPT,

        });

        const responseSchema = z.object({
            relevantFacts: z.array(z.object({
                topic: z.string().describe("The main topic of the facts."),
                fact: z.array(z.string().describe("A well detailed and complete summary of a fact of the topic.")).describe("A list of the relevant facts about the topic."),
            })).describe("A list of the relevant information to the main subject of the conversation."),
        });

        const messagesAsString = messagesToString(newMessages, "Human", "AI");
        const previousConversationAsString = messagesToString(previousConversation, "Human", "AI");
        const tags = this.getAllTags().map(s => `"${s}"`).join(",");

        const functionResponse = await chain.predict({
            summary: previousConversationAsString,
            new_lines: messagesAsString, memoryTags: tags,
            tool_schema: JSON.stringify(
                (zodToJsonSchema(responseSchema) as JsonSchema7ObjectType).properties
            )
        });

        let relevantFacts;
        try {
            relevantFacts = responseSchema.parse(JSON.parse(callJsonRepair(functionResponse)));
        } catch (error) {
            console.warn("Error parsing response from fact memory extractor.", error);
            return;
        }

        for (const relevantInformation of relevantFacts.relevantFacts) {
            for (const information of relevantInformation.fact) {
                await this.addTag([relevantInformation.topic], `${information}`);
            }
        }
        await this.save();
    }

    async findRelevantTags(currentBuffer: string, newMessages: string) {

        const responseSchema = z.object({
            factList: z.array(z.string().describe("a tag from the list of tags")).describe("A list of the relevant information to the main subject of the conversation. If there is no relevant information related to the new lines of conversations return an empty array response."),
        });

        const chain: LLMChain = new LLMChain({
            llm: this.model,
            prompt: TAG_FINDER_PROMPT,
        });

        const tags = this.getAllTags();
        if (tags.length === 0) {
            return [];
        }
        const functionResponse = await chain.predict({
            summary: currentBuffer,
            new_lines: newMessages,
            tool_schema: JSON.stringify(
                (zodToJsonSchema(responseSchema) as JsonSchema7ObjectType).properties
            ),
            memoryTags: tags.map(s => `"${s}"`).join(",")
        });

        let listOfRelevantTags;
        try {
            listOfRelevantTags = responseSchema.parse(JSON.parse(callJsonRepair(functionResponse)));
        } catch (error) {
            console.warn("Error parsing response from fact memory extractor.", error);
            return [];
        }
        return listOfRelevantTags.factList;
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
            const res = this.relevantInformation.get(tag) ?? [];
            return {
                tag: tag,
                facts: res
            };
        }).flat();
        return relevtanInformation;
    }
}


