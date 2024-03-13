
import { BaseMessage } from "@langchain/core/messages";
import { InputValues } from "@langchain/core/utils/types";
import { BaseChatMemory, ChatMessageHistory } from "langchain/memory";


export type MessagePair = { input: InputValues, output: Record<string, any> };
export type TrimmingMemoryInput = {
    startCollectionFilter: (message: MessagePair) => boolean,
}

export class TrimmingMemory extends BaseChatMemory {

    memory: BaseChatMemory;

    startCollectionFilter: (message: MessagePair) => boolean;
    lastGoodMessages: BaseMessage[] = [];
    pendingMemory: InputValues | undefined

    constructor(memory: BaseChatMemory, args: TrimmingMemoryInput) {
        super({
            chatHistory: new ChatMessageHistory(),
            inputKey: memory.inputKey,
            outputKey: memory.outputKey,
            returnMessages: memory.returnMessages,
        });
        this.startCollectionFilter = args.startCollectionFilter ?? (() => true);
        this.memory = memory;
    }


    get memoryKeys(): string[] {
        return this.memory.memoryKeys;
    }


    async saveContext(inputValues: InputValues, outputValues: Record<string, any>): Promise<void> {
        if (this.startCollectionFilter({ input: inputValues, output: outputValues })) {
            if (!(this.lastGoodMessages.length > 0)) {
                this.pendingMemory = inputValues;
                this.lastGoodMessages = [...(await this.memory.chatHistory.getMessages())];
            }

            return await this.memory.saveContext(inputValues, outputValues);
        } else {
            if (this.pendingMemory) {
                await this.memory.clear();
                for (const message of this.lastGoodMessages) {
                    await this.memory.chatHistory.addMessage(message);
                }

                await this.memory.saveContext(this.pendingMemory, outputValues);
                this.lastGoodMessages = [];
                this.pendingMemory = undefined;

            } else {
                return await this.memory.saveContext(inputValues, outputValues);
            }

        }

    }
    async loadMemoryVariables(_values: InputValues): Promise<Record<string, any>> {
        const normalMemory = await this.memory.loadMemoryVariables(_values);
        const messages = [
            ...normalMemory[Object.keys(normalMemory)[0]],
        ];
        const result = {
            [Object.keys(normalMemory)[0]]: messages,
        };
        return result;
    }
}
export const getInputValue = (inputValues: InputValues, inputKey?: string) => {
    if (inputKey !== undefined) {
        return inputValues[inputKey];
    }
    const keys = Object.keys(inputValues);
    if (keys.length === 1) {
        return inputValues[keys[0]];
    }
    throw new Error(
        `input values have multiple keys, memory only supported when one key currently: ${keys}`
    );
};

