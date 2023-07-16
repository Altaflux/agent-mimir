import { BaseChatMemory, BaseMemory } from "langchain/memory";
import { InputValues, BaseMessage } from "langchain/schema";


import { MimirAIMessage } from "../agent/base-agent.js";
import { AiMessageSerializer, HumanMessageSerializer } from "./serializers.js";


export class TransformationalMemory extends BaseMemory {

    constructor(private innerMemory: BaseChatMemory, private aiMessageSerializer: AiMessageSerializer, private humanMessageSerializer: HumanMessageSerializer) {
        super();
    }

    get memoryKeys(): string[] {
        return this.innerMemory.memoryKeys;
    }
    async saveContext(inputValues: InputValues, outputValues: Record<string, any>): Promise<void> {

        let output = await getInputValue(outputValues, this.innerMemory.outputKey);
        let input = await getInputValue(inputValues, this.innerMemory.inputKey); 
        try {
            const formattedOutput = (await getInputValue(outputValues, this.innerMemory.outputKey)) as MimirAIMessage;
            output = await this.aiMessageSerializer?.serialize(formattedOutput) ?? output;
        } catch (e) {
            console.log(e);
        }
        try {
            const formattedOutput = (await getInputValue(inputValues, this.innerMemory.inputKey)) as BaseMessage;
            input = await this.humanMessageSerializer?.serialize(formattedOutput) ?? output;
        } catch (e) {
            console.log(e);
        }

        const outputKey = this.innerMemory.outputKey ?? "output";
        const inputKey = this.innerMemory.inputKey ?? "input";
        await this.innerMemory.saveContext({
            [inputKey]: input,
        }, {
            [outputKey]: output,
        });

    }

    async loadMemoryVariables(_values: InputValues): Promise<Record<string, any>> {
        const result = await this.innerMemory.loadMemoryVariables(_values);
        if (this.innerMemory.memoryKeys.length > 1){
            throw new Error("TransformationalMemory only supports one memory key");
        }
        const outKey = this.innerMemory.memoryKeys[0];
        const messageHistory = getInputValue(result, outKey) as BaseMessage[];
        const formattedMessageHistory = await Promise.all(messageHistory.map(async (message) => {
            if (message._getType() === "ai") {
               return await this.aiMessageSerializer.deserialize(message.text)
            }
            if (message._getType() === "human") {
                return await this.humanMessageSerializer.deserialize(message.text)
             }
            return message;
        }));
        return {
            [outKey]: formattedMessageHistory,
        };
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
