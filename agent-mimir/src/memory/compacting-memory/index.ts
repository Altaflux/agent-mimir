import { BaseChatMemory, BaseChatMemoryInput, getInputValue, } from "langchain/memory";
import { encode } from "gpt-3-encoder"
import { LLMChain } from "langchain/chains";
import { extractTextContent, messagesToString } from "../../utils/format.js";
import { COMPACT_PROMPT } from "./prompt.js";
import { MemoryCompactionCallback } from "../../schema.js";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { InputValues } from "@langchain/core/utils/types";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseLanguageModel } from "@langchain/core/language_models/base";

type Payload = {
    participant: string,
    task: string,
    payload: string,
}
export type CompactedMessageDeserializer = (message: Payload) => BaseMessage;

export type WindowedConversationSummaryMemoryInput = BaseChatMemoryInput & {
    memoryKey?: string;
    humanPrefix?: string;
    aiPrefix?: string;
    embeddings: Embeddings;
    compressionBatchSize?: number;
    tokenLimit?: number;
    conversationTokenThreshold?: number;
    compactionCallback?: MemoryCompactionCallback;
    plainTextCompacting: boolean;
};

export class CompactingConversationSummaryMemory extends BaseChatMemory {

    memoryKey = "history";

    humanPrefix = "Human";

    aiPrefix = "AI";

    tokenLimit = 4000;

    conversationTokenThreshold = 75;

    compressionBatchSize: number = 40000;

    llm: BaseLanguageModel;

    embeddings: Embeddings;

    compactedMessageDeserializer: CompactedMessageDeserializer;

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
        this.embeddings = fields.embeddings;
        this.compactionCallback = fields?.compactionCallback ?? (async () => { });
        this.tokenLimit = fields?.tokenLimit ?? this.tokenLimit;
        this.compactedMessageDeserializer = fields.plainTextCompacting ? plainTextPayloadToMessage : functionPayloadToMessage;
        this.conversationTokenThreshold = fields?.conversationTokenThreshold ?? this.conversationTokenThreshold;
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

        // Disable compaction for now
        //    await this.compactMemory();

        const outputKey = this.outputKey ?? "output";
        const inputKey = this.inputKey ?? "input";
        await super.saveContext({
            [inputKey]: input,
        }, {
            [outputKey]: output,
        });
    }

    async compactMemory() {
        const newMessages = await this.chatHistory.getMessages();
        const totalMessages = [...newMessages];
        const numberOfAlreadyCompactedMessages = totalMessages.filter(e => e.additional_kwargs["compacted"]).length;
        const tokenEncode = (messages: BaseMessage[]) => encode(messages.map(e => JSON.stringify(extractTextContent(e.content)) + JSON.stringify(e.additional_kwargs?.function_call ?? {})).join("\n"));

        if (tokenEncode(totalMessages).length > this.tokenLimit) {
            const newMessagesToSummarize: BaseMessage[] = [];
            const newMessagesToCompact: BaseMessage[] = [];

            const maxNumberOfSummarizableMessages = totalMessages.length * (this.conversationTokenThreshold / 100.0);
            while (newMessagesToSummarize.length < maxNumberOfSummarizableMessages && totalMessages.length !== 0 && tokenEncode(newMessagesToSummarize).length < this.compressionBatchSize) {
                const humanMessage = totalMessages.shift()!;
                const aiMessage = totalMessages.shift()!;
                newMessagesToSummarize.push(humanMessage, aiMessage);

                if (newMessagesToSummarize.length > numberOfAlreadyCompactedMessages) {
                    newMessagesToCompact.push(humanMessage, aiMessage);
                }
            }
            const leftOverNewerMessages = [...totalMessages];

            if (newMessagesToCompact.length > 0) {
                await this.compactionCallback(newMessagesToCompact, newMessages.slice(0, numberOfAlreadyCompactedMessages));
            }
            const compactedMessages = await this.messageCompact(newMessagesToSummarize, this.llm);

            const compactedMessagesLenght = tokenEncode(compactedMessages).length;
            const newMessagesLenght = tokenEncode(newMessagesToSummarize).length;
            console.log(`Compacted ${newMessagesToSummarize.length} messages into ${compactedMessages.length} messages. ${compactedMessagesLenght} characters vs ${newMessagesLenght} characters.`);

            await this.chatHistory.clear();
            for (const leftOverNewerMessage of [...compactedMessages, ...leftOverNewerMessages]) {
                await this.chatHistory.addMessage(leftOverNewerMessage);
            }
        }
    }


    async clear() {
        await super.clear();
    }


    async messageCompact(messages: BaseMessage[], llm: BaseLanguageModel) {
        const formattedMessages = messagesToString(messages);

        const chain = new LLMChain({ llm: llm, prompt: COMPACT_PROMPT });
        const compactedConversation = await chain.predict({
            conversation: formattedMessages,
        });
        const rawMessages = splitConversation(compactedConversation)
            .map(e => extractPayload(e))
            .map(e => this.compactedMessageDeserializer(e));

        return rawMessages;
    }

}

function splitConversation(text: string) {
    const splittedMessages = text.split("Start-Of-Message:").map(e => e.trim()).filter(e => e !== "");
    return splittedMessages;
}

function extractPayload(text: string): Payload {
    const participantExtractor = new RegExp(`(?<=- Participant:\\s)([\\s\\S]*?)` + '(?=\\s' + "- Participant|- Task|- Payload" + "|$)");
    const taskExtractor = new RegExp(`(?<=- Task:\\s)([\\s\\S]*?)` + '(?=\\s' + "- Participant|- Task|- Payload" + "|$)");
    const payloadExtractor = new RegExp(`(?<=- Payload:\\s)([\\s\\S]*?)` + '(?=\\s' + "- Participant|- Task|- Payload" + "|$)");

    return {
        participant: participantExtractor.exec(text)?.[0]?.trim() ?? "?",
        task: taskExtractor.exec(text)?.[0]?.trim() ?? "message",
        payload: payloadExtractor.exec(text)?.[0]?.trim() ?? "",
    }
}

export function plainTextPayloadToMessage(payload: Payload) {

    if (payload.participant === "Human") {
        return new HumanMessage({
            content: [
                {
                    type: "text",
                    text: payload.payload,
                }
            ]
        }, {
            compacted: true,
        });
    } else {
        return new AIMessage({
            content: [
                {
                    type: "text",
                    text: payload.payload,
                }
            ]
        }, {
            compacted: true,
        });
    }
}

export function functionPayloadToMessage(payload: Payload) {
    if (payload.participant === "Human") {
        return new HumanMessage({
            content: [
                {
                    type: "text",
                    text: payload.payload,
                }
            ]
        }, {
            compacted: true,
        });
    } else {
        return new AIMessage({
            content: [
                {
                    type: "text",
                    text: "",
                }
            ]
        }, {
            compacted: true,
            function_call: {
                name: payload.task,
                arguments: payload.payload,
            },
        });
    }
}
