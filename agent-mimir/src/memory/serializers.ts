
import {  BaseChatMessage, StoredMessage } from "langchain/schema";
import { mapStoredMessagesToChatMessages } from "../utils/format.js";


export abstract class HumanMessageSerializer {
    abstract serialize(message: BaseChatMessage): Promise<string>;
    async deserialize(text: string): Promise<BaseChatMessage > {
        const message = JSON.parse(text) as StoredMessage;
        const chatMessage = mapStoredMessagesToChatMessages([message])[0];
        return chatMessage;
    };
}

export class DefaultHumanMessageSerializerImp extends HumanMessageSerializer {
    async serialize(message: BaseChatMessage): Promise<string> {
        const serializedMessage = message.toJSON();
        return JSON.stringify(serializedMessage);
    }
}

export abstract class AiMessageSerializer {
    abstract serialize(message: any): Promise<string>;

    async deserialize(message: string): Promise<BaseChatMessage> {
        const storedMessage = JSON.parse(message) as StoredMessage;
        const chatMessage = mapStoredMessagesToChatMessages([storedMessage])[0];
        return chatMessage;
    };
}

