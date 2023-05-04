import { BaseLanguageModel } from "langchain/base_language";

import { BaseChatMemory, BaseChatMemoryInput, getBufferString, getInputValue, } from "langchain/memory";
import { BasePromptTemplate } from "langchain/prompts";
import { BaseChatMessage, InputValues, SystemChatMessage } from "langchain/schema";
import { SUMMARY_PROMPT } from "./prompt.js";
import { LLMChain } from "langchain/chains";


import { AIMessageSerializer, AIMessageType } from "../../schema.js";

export type WindowedConversationSummaryMemoryInput = BaseChatMemoryInput & {
    memoryKey?: string;
    humanPrefix?: string;
    aiPrefix?: string;
    prompt?: BasePromptTemplate;
    maxWindowSize?: number;
    messageSerializer?: AIMessageSerializer;
    summaryChatMessageClass?: new (content: string) => BaseChatMessage;
};

export class WindowedConversationSummaryMemory extends BaseChatMemory {
    buffer = "";

    memoryKey = "history";

    humanPrefix = "Human";

    aiPrefix = "AI";

    llm: BaseLanguageModel;

    prompt: BasePromptTemplate = SUMMARY_PROMPT;

    private maxWindowSize = 6;

    summaryChatMessageClass: new (content: string) => BaseChatMessage =
        SystemChatMessage;

    messageSerializer?: AIMessageSerializer;

    constructor(llm: BaseLanguageModel, fields?: WindowedConversationSummaryMemoryInput) {
        const {
            returnMessages,
            inputKey,
            outputKey,
            chatHistory,
            humanPrefix,
            aiPrefix,
            prompt,
            summaryChatMessageClass,
        } = fields ?? {};

        super({ returnMessages, inputKey, outputKey, chatHistory });

        this.memoryKey = fields?.memoryKey ?? this.memoryKey;
        this.humanPrefix = humanPrefix ?? this.humanPrefix;
        this.aiPrefix = aiPrefix ?? this.aiPrefix;
        this.llm = llm
        this.prompt = prompt ?? this.prompt;
        this.summaryChatMessageClass =
            summaryChatMessageClass ?? this.summaryChatMessageClass;
        this.messageSerializer = fields?.messageSerializer;
    }

    get memoryKeys(): string[] {
        return [this.memoryKey]
    }

    async predictNewSummary(
        messages: BaseChatMessage[],
        existingSummary: string
    ): Promise<string> {
        const newLines = getBufferString(messages, this.humanPrefix, this.aiPrefix);
        const chain = new LLMChain({ llm: this.llm, prompt: this.prompt });
        return await chain.predict({
            summary: existingSummary,
            new_lines: newLines,
        });
    }

    async loadMemoryVariables(_: InputValues): Promise<Record<string, any>> {
        const messages = await this.chatHistory.getMessages();
        if (this.returnMessages) {

            const result = {
                [this.memoryKey]:
                    this.buffer.length > 0 ?
                        [new this.summaryChatMessageClass(this.buffer), ...messages]
                        : [...messages],
            };
            return result;
        }
        const result = { [this.memoryKey]: this.buffer + getBufferString(messages) };
        return result;
    }

    async saveContext(
        inputValues: InputValues,
        outputValues: Record<string, any>
    ): Promise<void> {
        let output = await getInputValue(outputValues, this.outputKey);
        let input = `${await getInputValue(inputValues, this.inputKey)}`;
        try {
            const formattedOutput = JSON.parse(await getInputValue(outputValues, this.outputKey)) as AIMessageType;
            output = await this.messageSerializer?.serialize(formattedOutput) ?? output;
        } catch (e) {

        }

        const outputKey = this.outputKey ?? "output";
        const inputKey = this.inputKey ?? "input";
        await super.saveContext({
            [inputKey]: input,
        }, {
            [outputKey]: output,
        });


        const messages = await this.chatHistory.getMessages();
        if (messages.length > this.maxWindowSize * 2) {
            const newMessagesToSummarize: BaseChatMessage[] = [];
            while (messages.length > this.maxWindowSize) {
                newMessagesToSummarize.push(messages.shift()!);
                newMessagesToSummarize.push(messages.shift()!);
            }
            this.buffer = await this.predictNewSummary(newMessagesToSummarize, this.buffer);

        }
    }

    async clear() {
        await super.clear();
        this.buffer = "";
    }
}
