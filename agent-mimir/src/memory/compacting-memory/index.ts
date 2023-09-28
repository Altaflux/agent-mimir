import { BaseLanguageModel } from "langchain/base_language";

import { BaseChatMemory, BaseChatMemoryInput, getInputValue, } from "langchain/memory";
import { AIMessage, BaseMessage, HumanMessage, InputValues } from "langchain/schema";
import { encode } from "gpt-3-encoder"
import { LLMChain } from "langchain/chains";
import { messagesToString } from "../../utils/format.js";
import { COMPACT_PROMPT } from "./prompt.js";
import { MemoryCompactionCallback } from "../../schema.js";
import { Embeddings } from "langchain/embeddings";

export type WindowedConversationSummaryMemoryInput = BaseChatMemoryInput & {
    memoryKey?: string;
    humanPrefix?: string;
    aiPrefix?: string;
    maxWindowSize?: number;
    embeddings: Embeddings;
    tokenLimit?: number;
    conversationTokenThreshold?: number;
    compactionCallback?: MemoryCompactionCallback;
};

export class CompactingConversationSummaryMemory extends BaseChatMemory {

    compactedMessagesCount: number = 0;

    memoryKey = "history";

    humanPrefix = "Human";

    aiPrefix = "AI";

    tokenLimit = 4000;

    conversationTokenThreshold = 100;

    llm: BaseLanguageModel;

    embeddings: Embeddings

    private maxWindowSize = 6;

    compactionCallback: MemoryCompactionCallback;

    constructor(llm: BaseLanguageModel, fields: WindowedConversationSummaryMemoryInput) {
        const {
            returnMessages,
            inputKey,
            outputKey,
            chatHistory,
            humanPrefix,
            aiPrefix,
        } = fields ?? {};

        super({ returnMessages, inputKey, outputKey, chatHistory });

        this.memoryKey = fields?.memoryKey ?? this.memoryKey;
        this.humanPrefix = humanPrefix ?? this.humanPrefix;
        this.aiPrefix = aiPrefix ?? this.aiPrefix;
        this.llm = llm
        this.maxWindowSize = fields?.maxWindowSize ?? this.maxWindowSize;
        this.embeddings = fields.embeddings;
        this.compactionCallback = fields?.compactionCallback ?? (async () => { });
        this.tokenLimit = fields?.tokenLimit ?? this.tokenLimit;
    }

    get memoryKeys(): string[] {
        return [this.memoryKey]
    }

    async loadMemoryVariables(_: InputValues): Promise<Record<string, any>> {

        const messages = await this.chatHistory.getMessages();
        if (this.returnMessages) {
            const result = {
                [this.memoryKey]: messages,
            };
            return result;
        }
        const result = { [this.memoryKey]: messagesToString(messages) };
        return result;
    }

    async saveContext(
        inputValues: InputValues,
        outputValues: Record<string, any>
    ): Promise<void> {
        let output = await getInputValue(outputValues, this.outputKey);
        let input = await getInputValue(inputValues, this.inputKey);


        await this.compactIfNeeded();

        const outputKey = this.outputKey ?? "output";
        const inputKey = this.inputKey ?? "input";
        await super.saveContext({
            [inputKey]: input,
        }, {
            [outputKey]: output,
        });

    }

    async compactIfNeeded() {
        const newMessages = await this.chatHistory.getMessages();
        const totalMessages = [...newMessages];

        const tokenEncode = (messages: BaseMessage[]) => encode(messages.map(e => e.content).join("\n"));

        if (tokenEncode(totalMessages).length > this.tokenLimit) {
            const newMessagesToSummarize: BaseMessage[] = [];
            const newMessagesToCompact: BaseMessage[] = [];

            const maxNumberOfSummarizableMessages = totalMessages.length * (this.conversationTokenThreshold / 100.0);
            while (newMessagesToSummarize.length < maxNumberOfSummarizableMessages && totalMessages.length !== 0) {
                const humanMessage = totalMessages.shift()!;
                const aiMessage = totalMessages.shift()!;
                newMessagesToSummarize.push(humanMessage, aiMessage);

                if (newMessagesToSummarize.length > this.compactedMessagesCount) {
                    newMessagesToCompact.push(humanMessage, aiMessage);
                }
            }
            const leftOverNewerMessages = [...totalMessages];

            if (newMessagesToCompact.length > 0) {
                await this.compactionCallback(newMessagesToCompact, newMessages.slice(0, this.compactedMessagesCount));
            }
            const compactedMessages = await messageCompact(newMessagesToSummarize, this.llm);
            await this.chatHistory.clear();
            for (const leftOverNewerMessage of [...compactedMessages, ...leftOverNewerMessages]) {
                await this.chatHistory.addMessage(leftOverNewerMessage);
            }
            this.compactedMessagesCount = newMessagesToCompact.length;
        }
    }

    async clear() {
        await super.clear();
        this.compactedMessagesCount = 0;
    }
}

async function messageCompact(messages: BaseMessage[], llm: BaseLanguageModel) {
    const formattedMessages = messagesToString(messages);

    const chain = new LLMChain({ llm: llm, prompt: COMPACT_PROMPT });
    const compactedConversation = await chain.predict({
        conversation: formattedMessages,
    });
    const rawMessages = splitConversation(compactedConversation);
    const newMessages = rawMessages.map(
        (message) => {
            if (message.name === "Human") {
                return new HumanMessage(message.message);
            } else {
                return new AIMessage(message.message);
            }
        }
    );
    return newMessages;
}

function splitConversation(text: string) {
    // Regular expression to match the "Name: Message" format
    const pattern = /(Human|AI+): (.*?)(?=Human|AI+:|$)/gs;

    let matches;
    let exchanges = [];
    while ((matches = pattern.exec(text)) !== null) {
        // 'matches[0]' contains the full match (e.g., "Human: Hey Jordan...")
        // 'matches[1]' contains the name (e.g., "Human")
        // 'matches[2]' contains the message (e.g., "Hey Jordan...")
        exchanges.push({
            name: matches[1],
            message: matches[2].trim() // remove any trailing spaces or line breaks
        });
    }

    return exchanges;
}
