
import { BaseChatMemory, ChatMessageHistory } from "langchain/memory";
import { InputValues } from "langchain/schema";


export type MessagePair = { input: InputValues, output: Record<string, any> };
export type TrimmingMemoryInput = {
    startCollectionFilter: (message: MessagePair) => boolean,
}

export class TrimmingMemory extends BaseChatMemory {

    memory: BaseChatMemory;
    pendingMessage: InputValues | undefined;
    startCollectionFilter: (message: MessagePair) => boolean;

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
            if (!this.pendingMessage) {
                this.pendingMessage = inputValues;
            }
            return await super.saveContext(inputValues, outputValues);
        } else {
            if (this.pendingMessage) {
                await this.memory.saveContext(this.pendingMessage, outputValues);
                this.pendingMessage = undefined;
                await this.chatHistory.clear();
                return;
            }
            return await this.memory.saveContext(inputValues, outputValues);
        }

    }
    async loadMemoryVariables(_values: InputValues): Promise<Record<string, any>> {
        const normalMemory = await this.memory.loadMemoryVariables(_values);
        const pending = await this.chatHistory.getMessages();
        const messages = [
            ...normalMemory[Object.keys(normalMemory)[0]],
            ...pending,
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

