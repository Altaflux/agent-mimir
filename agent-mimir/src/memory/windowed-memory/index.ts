import { BaseLanguageModel } from "langchain/base_language";
import { BaseChatMemory, BaseChatMemoryInput, getInputValue, } from "langchain/memory";
import { BasePromptTemplate } from "langchain/prompts";
import { AIMessage, BaseMessage, InputValues, SystemMessage } from "langchain/schema";
import { SUMMARY_PROMPT } from "./prompt.js";
import { LLMChain } from "langchain/chains";
import { messagesToString } from "../../utils/format.js";
import { MemoryCompactionCallback } from "../../schema.js";

export type WindowedConversationSummaryMemoryInput = BaseChatMemoryInput & {
    memoryKey?: string;
    humanPrefix?: string;
    aiPrefix?: string;
    prompt?: BasePromptTemplate;
    maxWindowSize?: number;
    summaryChatMessageClass?: new (content: string) => BaseMessage;
    compactionCallback?: MemoryCompactionCallback;
};

export class WindowedConversationSummaryMemory extends BaseChatMemory {
    buffer = "";

    memoryKey = "history";

    humanPrefix = "Human";

    aiPrefix = "AI";

    llm: BaseLanguageModel;

    prompt: BasePromptTemplate = SUMMARY_PROMPT;

    private maxWindowSize = 6;

    summaryChatMessageClass: new (content: string) => BaseMessage = SystemMessage;

    compactionCallback: MemoryCompactionCallback;

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
        this.maxWindowSize = fields?.maxWindowSize ?? this.maxWindowSize;
        this.prompt = prompt ?? this.prompt;
        this.summaryChatMessageClass =
            summaryChatMessageClass ?? this.summaryChatMessageClass;
        this.compactionCallback = fields?.compactionCallback ?? (async () => { });
    }

    get memoryKeys(): string[] {
        return [this.memoryKey]
    }

    async predictNewSummary(
        newLines: BaseMessage[],
        existingSummary: string
    ): Promise<string> {
        const messages = messagesToString(newLines, this.humanPrefix, this.aiPrefix); //Aqui los mensajes son JSON tambien, solo veo los de AI y Human
        const chain = new LLMChain({ llm: this.llm, prompt: this.prompt });
        return await chain.predict({
            summary: existingSummary,
            new_lines: messages,
        });
    }

    async loadMemoryVariables(_: InputValues): Promise<Record<string, any>> {
        const summaryText = `The following is a summary of the conversation so far. Use this summary to help you remember what has been said so far: ${this.buffer}`
        const messages = await this.chatHistory.getMessages();
        if (this.returnMessages) {
            const result = {
                [this.memoryKey]:
                    this.buffer.length > 0 ?
                        [new this.summaryChatMessageClass(summaryText), ...messages]
                        : [...messages],
            };
            return result;
        }
        const result = { [this.memoryKey]: this.buffer + messagesToString(messages) };
        return result;
    }

    async saveContext(
        inputValues: InputValues,
        outputValues: Record<string, any>
    ): Promise<void> {
        let output = await getInputValue(outputValues, this.outputKey);
        let input = await getInputValue(inputValues, this.inputKey);

        const outputKey = this.outputKey ?? "output";
        const inputKey = this.inputKey ?? "input";
        await super.saveContext({
            [inputKey]: input,
        }, {
            [outputKey]: output,
        });

        const messages = await this.chatHistory.getMessages();
        if (messages.length > this.maxWindowSize * 2) {
            const newMessagesToSummarize: BaseMessage[] = [];
            while (messages.length > this.maxWindowSize) {
                newMessagesToSummarize.push(messages.shift()!);
                newMessagesToSummarize.push(messages.shift()!);
            }
            await this.compactionCallback(newMessagesToSummarize, [new AIMessage(this.buffer)]);
            this.buffer = await this.predictNewSummary(newMessagesToSummarize, this.buffer);
        }
    }

    async clear() {
        await super.clear();
        this.buffer = "";
    }
}
