import { v4 } from "uuid";
import { AIMessage, BaseMessage, HumanMessage, MessageContent, MessageContentComplex, MessageContentImageUrl, MessageContentText, SystemMessage } from "@langchain/core/messages";
import { ComplexMessageContent, ImageMessageContent, TextMessageContent, SupportedImageTypes, } from "../schema.js";
import { CONSTANTS, ERROR_MESSAGES } from "./constants.js";
import { complexResponseToLangchainMessageContent } from "../utils/format.js";


export function commandContentToBaseMessage(commandContent: { type: string, content: ComplexMessageContent[] }): BaseMessage {
    const id = v4();
    const content = complexResponseToLangchainMessageContent(commandContent.content);

    if (commandContent.type === "assistant") {
        return new AIMessage({ id, content });
    } else if (commandContent.type === "user") {
        return new HumanMessage({ id, content });
    }
    throw new Error(ERROR_MESSAGES.UNREACHABLE);
}

export function lCmessageContentToContent(content: MessageContent): ComplexMessageContent[] {
    if (typeof content === 'string') {
        return [{
            type: "text",
            text: content
        }];
    }

    return (content as MessageContentComplex[]).map(c => {
        if (c.type === "text") {
            return {
                type: "text" as const,
                text: (c as MessageContentText).text
            } as TextMessageContent;
        }

        if (c.type === "image_url") {
            const imgContent = c as MessageContentImageUrl;
            const imageUrl = typeof imgContent.image_url === 'string' ?
                imgContent.image_url :
                imgContent.image_url.url;

            return {
                type: "image_url" as const,
                image_url: {
                    //TODO: We need to handle images per LLM provider, no LLM currently supports responding image types.
                    type: imgContent.type as SupportedImageTypes,
                    url: imageUrl,
                }
            } as ImageMessageContent;
        }

        return null
    }).filter(e => e !== null).map(e => e!);
}

export function mergeSystemMessages(messages: SystemMessage[]): SystemMessage {
    return messages.reduce((prev, next) => {
        const prevContent = typeof prev.content === 'string' ?
            [{ type: "text", text: prev.content }] as MessageContentText[] :
            prev.content as MessageContentComplex[];

        const nextContent = typeof next.content === 'string' ?
            [{ type: "text", text: next.content }] as MessageContentText[] :
            next.content as MessageContentComplex[];

        return new SystemMessage({ content: [...prevContent, ...nextContent] });
    }, new SystemMessage({ content: [] }));
}

export const dividerSystemMessage = new SystemMessage({
    content: [{
        type: "text",
        text: CONSTANTS.MESSAGE_DIVIDER
    }]
});
