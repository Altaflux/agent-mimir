import { BaseChain, SerializedBaseChain } from "langchain/chains";

import { BaseChatMemory } from "langchain/memory";
import { ChainValues, InputValues } from "langchain/schema";

type OutputValues = Record<string, any>;
type ChainMessage = {
    type: "human" | "ai",
    value: Record<string, any>;
}
export type MessagePair = { input: InputValues, output: OutputValues };
export class ChatMemoryChain extends BaseChain {

    chatMemory: BaseChatMemory;
    chain: BaseChain;
    messageFilter?: (message: MessagePair) => boolean;
    completeTransactionTrigger: (message: MessagePair) => boolean;
  
    pendingMessages: ChainMessage[] = [];
    pendingInput?: InputValues;

    constructor(
        chain: BaseChain,
        chatMemory: BaseChatMemory,
        args: {
            completeTransactionTrigger: (message: MessagePair) => boolean,
            messageFilter?: (message: MessagePair) => boolean,
        }) {
        super();
        this.chain = chain;
        this.chatMemory = chatMemory;
        this.completeTransactionTrigger = args.completeTransactionTrigger;
        this.messageFilter = args.messageFilter;
    }

    get inputKeys() {
        return this.chain.inputKeys;
    }

    get outputKeys() {
        return this.chain.outputKeys;
    }

    async _call(values: ChainValues): Promise<ChainValues> {
        const fullValues = { ...values } as typeof values;
        if (!(this.chatMemory == null)) {
            const newValues = await this.chatMemory.loadMemoryVariables(values);
            for (const [key, value] of Object.entries(newValues)) {
                fullValues[key] = value;
            }
        }
        const result = await this.chain.call(fullValues);
        if (values[this.chatMemory.inputKey!] !== undefined) {
            this.pendingMessages.push({
                type: "human",
                value: fullValues,
            });
        }

        const messagePair = { input: fullValues, output: result };
        if (this.messageFilter ? this.messageFilter(messagePair) : true) {
            this.pendingMessages.push({
                type: "ai",
                value: result,
            });
        }

        if (this.completeTransactionTrigger(messagePair)) {
            for  (let i = 0; i < this.pendingMessages.length; i += 2) {
                const hummanMessage = this.pendingMessages[i];
                const aiMessage = this.pendingMessages[i + 1];
                await this.chatMemory.saveContext(hummanMessage.value, aiMessage.value);
            }
            this.pendingMessages = [];
        }
        return result;
    }


    _chainType(): string {
        return "memory_chain" as const;
    };


    serialize(): SerializedBaseChain {
        throw new Error("Not implemented");
    }
}