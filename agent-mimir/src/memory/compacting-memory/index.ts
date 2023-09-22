import { BaseLanguageModel } from "langchain/base_language";

import { BaseChatMemory, BaseChatMemoryInput, ChatMessageHistory, getInputValue, } from "langchain/memory";
import { BasePromptTemplate } from "langchain/prompts";
import { AIMessage, BaseMessage, HumanMessage, InputValues, SystemMessage } from "langchain/schema";

import { LLMChain } from "langchain/chains";
import { formatForCompaction, getBufferString2 } from "../../utils/format.js";
import { MemoryCompactionCallback } from "../windowed-memory/index.js";
import { COMPACT_PROMPT } from "./prompt.js";
import { MimirHumanReplyMessage } from "../../schema.js";
import { MimirAIMessage } from "../../agent/base-agent.js";

export type WindowedConversationSummaryMemoryInput = BaseChatMemoryInput & {
    memoryKey?: string;
    humanPrefix?: string;
    aiPrefix?: string;
    prompt?: BasePromptTemplate;
    maxWindowSize?: number;
    summaryChatMessageClass?: new (content: string) => BaseMessage;
    compactionCallback?: MemoryCompactionCallback;
};

export class CompactingConversationSummaryMemory extends BaseChatMemory {


    compactedMessages: BaseMessage[] = [];

    memoryKey = "history";

    humanPrefix = "Human";

    aiPrefix = "AI";

    llm: BaseLanguageModel;

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
        this.summaryChatMessageClass =
            summaryChatMessageClass ?? this.summaryChatMessageClass;
        this.compactionCallback = fields?.compactionCallback ?? (async () => { });
    }

    get memoryKeys(): string[] {
        return [this.memoryKey]
    }

 

    async loadMemoryVariables(_: InputValues): Promise<Record<string, any>> {

        const messages = await this.chatHistory.getMessages();
        if (this.returnMessages) {
            const result = {
                [this.memoryKey]: [...this.compactedMessages, ...messages],
            };
            return result;
        }
        const result = { [this.memoryKey]: getBufferString2(this.compactedMessages) + getBufferString2(messages) };
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

        //Creo que aqui puede que haya mensajes que no se estan utilizando para el buffer, puede hacer que al sistema le falte contexto.
        const newMessages = await this.chatHistory.getMessages();
        const totalMessages = [...this.compactedMessages, ...newMessages];
        if (totalMessages.length > this.maxWindowSize * 2) {
            const newMessagesToSummarize: BaseMessage[] = [];
            while (totalMessages.length > this.maxWindowSize) {
                newMessagesToSummarize.push(totalMessages.shift()!);
                newMessagesToSummarize.push(totalMessages.shift()!);
            }
            const leftOverNewerMessages = [...totalMessages];
            this.chatHistory = new ChatMessageHistory(leftOverNewerMessages);
            //This callback must only be called for messagges that have never been summarized before.
            // await this.compactionCallback(newMessagesToSummarize, this.buffer);
            this.compactedMessages = await messageCompact(newMessagesToSummarize, this.llm);
        }
    }

    async clear() {
        await super.clear();
        this.compactedMessages = [];
    }
}

async function messageCompact(messages: BaseMessage[], llm: BaseLanguageModel) {
    const formattedMessages = formatForCompaction(messages);

    const chain = new LLMChain({ llm: llm, prompt: COMPACT_PROMPT! });
    const compactedConversation = await chain.predict({
        conversation: formattedMessages,
    });
    const rawMessages = splitConversation(compactedConversation);
    const newMessages = rawMessages.map(
        (message) => {
            if (message.name === "Human") {
                const humanMessage: MimirHumanReplyMessage = {
                    type: "USER_MESSAGE",
                    message: message.message,
                }
                return new HumanMessage(JSON.stringify(humanMessage));
            } else {
                const aiMessage: MimirAIMessage = {
                    text: message.message,
                }
                return new AIMessage(JSON.stringify(aiMessage));
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
