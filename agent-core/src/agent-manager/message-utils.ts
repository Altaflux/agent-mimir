import { v4 } from "uuid";
import { AIMessage, BaseMessage, ContentBlock, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ComplexMessageContent, ImageMessageContent, TextMessageContent } from "../schema.js";
import { CONSTANTS, ERROR_MESSAGES } from "./constants.js";
import { complexResponseToLangchainMessageContent } from "../utils/format.js";
import { InputAgentMessage, SharedFile } from "./index.js";


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

export function lCmessageContentToContent(content: ContentBlock[] | string): ComplexMessageContent[] {
    if (typeof content === 'string') {
        return [{
            type: "text",
            text: content
        }];
    }

    return (content as ContentBlock[]).map(c => {
        if (c.type === "text") {
            return {
                type: "text" as const,
                text: (c as ContentBlock.Text).text
            } satisfies TextMessageContent;
        }

        if (c.type === "image") {
            //TODO FIX FOR HANDLING BETTER url types
            const imgContent = c as ContentBlock.Multimodal.Image;
            const imageUrl = typeof imgContent.data === 'string' ?
                imgContent.data :
                undefined!;

            return {
                type: "image" as const,
                mimeType: imgContent.mimeType,
                data: imgContent.data as string,

            } satisfies ImageMessageContent;
        }

        return null
    }).filter(e => e !== null).map(e => e!);
}

export function mergeSystemMessages(messages: SystemMessage[]): SystemMessage {
    return messages.reduce((prev, next) => {
        const prevContent = typeof prev.content === 'string' ?
            [{ type: "text", text: prev.content }] satisfies ContentBlock.Text[] :
            prev.contentBlocks satisfies ContentBlock.Standard[];

        const nextContent = typeof next.content === 'string' ?
            [{ type: "text", text: next.content }] satisfies ContentBlock.Text[] :
            next.contentBlocks satisfies ContentBlock.Standard[];

        return new SystemMessage({ contentBlocks: [...prevContent, ...nextContent] });
    }, new SystemMessage({ content: [] }));
}

export const dividerSystemMessage = {
    type: "text",
    text: CONSTANTS.MESSAGE_DIVIDER
} satisfies ComplexMessageContent;


export function humanMessageToInputAgentMessage(message: HumanMessage): InputAgentMessage {
    return {
        content: lCmessageContentToContent(message.contentBlocks),
        sharedFiles: [
            ...(message.additional_kwargs?.["sharedFiles"] as SharedFile[] ?? [])
        ]
    }
}

export function toolMessageToInputAgentMessage(message: ToolMessage): InputAgentMessage {
    return {
        content: lCmessageContentToContent(message.contentBlocks),
        sharedFiles: [
            ...(message.additional_kwargs?.["sharedFiles"] as SharedFile[] ?? [])
        ]
    }
}