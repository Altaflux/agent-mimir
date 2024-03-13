import { BaseMessage } from "@langchain/core/messages";
import { MimirAIMessage } from "../agent/base-agent.js";
import { MimirHumanReplyMessage } from "../schema.js";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";

export abstract class HumanMessageSerializer {
    abstract deserialize(message: MimirHumanReplyMessage): Promise<BaseMessage>;
}

export abstract class AiMessageSerializer {
    abstract deserialize(message: MimirAIMessage): Promise<BaseMessage>;
}


export class TransformationalChatMessageHistory extends BaseChatMessageHistory {
    async addMessage(message: BaseMessage): Promise<void> {
        await this.delegate.addMessage(message);
    }

    constructor(private delegate: BaseChatMessageHistory, private aiMessageSerializer: AiMessageSerializer, private humanMessageSerializer: HumanMessageSerializer) {
        super();
    }
    async getMessages(): Promise<BaseMessage[]> {
        const messageHistory = await this.delegate.getMessages();
        return messageHistory;
    }

    async addUserMessage(message: string): Promise<void> {
        const formattedMessage = await this.humanMessageSerializer.deserialize((message) as any as MimirHumanReplyMessage)
        return await this.addMessage(formattedMessage);
    }
    async addAIChatMessage(message: string): Promise<void> {
        const formattedMessage = await this.aiMessageSerializer.deserialize((message) as any as MimirAIMessage)
        return await this.addMessage(formattedMessage);
    }

    async clear(): Promise<void> {
        return await this.delegate.clear();
    }

    lc_namespace: string[] = [];

}
