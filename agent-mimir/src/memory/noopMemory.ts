import { InputValues } from "@langchain/core/utils/types";
import { BaseChatMemory, BaseChatMemoryInput } from "langchain/memory";

export type NoopMemoryInput = BaseChatMemoryInput & {
    memoryKey?: string;
};

export class NoopMemory extends BaseChatMemory {

    memoryKey = "history";

    constructor(fields: NoopMemoryInput) {
        const {
            returnMessages,
            inputKey,
            outputKey,
            chatHistory,
        } = fields ?? {};
        super({ returnMessages, inputKey, outputKey, chatHistory });
        this.memoryKey = fields?.memoryKey ?? this.memoryKey;
    }
    get memoryKeys(): string[] {
        return [this.memoryKey]
    }

    async loadMemoryVariables(_: InputValues): Promise<Record<string, any>> {
        if (this.returnMessages) {
            const result = {
                [this.memoryKey]: []
            };
            return result;
        }
        const result = { [this.memoryKey]: "" };
        return result;
    }
}