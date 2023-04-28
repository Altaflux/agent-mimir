import { BaseChain, SerializedBaseChain } from "langchain/chains";

import { BaseMemory } from "langchain/memory";
import { ChainValues, InputValues } from "langchain/schema";

type OutputValues = Record<string, any>;

export type MessagePair = { input: InputValues, output: OutputValues };
export class ChatMemoryChain extends BaseChain {

    chatMemory: BaseMemory;
    chain: BaseChain;
    messageFilter?: (message: MessagePair) => boolean;
    completeTransactionTrigger: (message: MessagePair) => boolean;
    userConversation: MessagePair[] = [];
    pendingInput?: InputValues;

    constructor(
        chain: BaseChain,
        chatMemory: BaseMemory,
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
        const messagePair = { input: fullValues, output: result };
        if (this.messageFilter ? this.messageFilter(messagePair) : true) {
            this.userConversation.push(messagePair);
        }

        if (this.completeTransactionTrigger(messagePair)) {
            for await (const conversationPiece of this.userConversation) {
                await this.chatMemory.saveContext(conversationPiece.input, conversationPiece.output);
            }
            this.userConversation = [];
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