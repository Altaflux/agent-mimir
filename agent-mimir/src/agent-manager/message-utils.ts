import { v4 } from "uuid";
import { AIMessage, BaseMessage, HumanMessage, MessageContent, MessageContentComplex, MessageContentImageUrl, MessageContentText, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ComplexResponse, ResponseContentImage, ResponseContentText, SupportedImageTypes, } from "../schema.js";
import { CONSTANTS, ERROR_MESSAGES } from "./constants.js";
import { complexResponseToLangchainMessageContent } from "../utils/format.js";
import { AgentMessageToolRequest, } from "./index.js";
import { NextMessageToolResponse } from "../plugins/index.js";

export function toolMessageToToolResponseInfo(message: { name?: string, content: any }): { name: string, response: string } {
    return {
        name: message.name ?? "Unknown",
        response: trimStringToMaxWithEllipsis(JSON.stringify(message.content), CONSTANTS.MAX_TOOL_RESPONSE_LENGTH)
    };
}

export function trimStringToMaxWithEllipsis(str: string, max: number): string {
    return str.length > max ? str.substring(0, max) + "..." : str;
}


export function langChainToolMessageToMimirHumanMessage(message: ToolMessage): NextMessageToolResponse {
    return {
        type: "TOOL_RESPONSE",
        toolName: message.name ?? "Unknown",
        toolCallId: message.tool_call_id,
        content: lCmessageContentToContent(message.content)
    };
}

export function parseToolMessage(aiMessage: AIMessage, responseAttributes: Record<string, any>): AgentMessageToolRequest {
    const content = lCmessageContentToContent(aiMessage.content);
    return {
        toolCalls: (aiMessage.tool_calls ?? []).map(t => ({
            toolName: t.name,
            input: t.args
        })),
        content: content
    };
}

export function commandContentToBaseMessage(commandContent: { type: string, content: ComplexResponse[] }): BaseMessage {
    const id = v4();
    const content = complexResponseToLangchainMessageContent(commandContent.content);

    if (commandContent.type === "assistant") {
        return new AIMessage({ id, content });
    } else if (commandContent.type === "user") {
        return new HumanMessage({ id, content });
    }
    throw new Error(ERROR_MESSAGES.UNREACHABLE);
}

export function lCmessageContentToContent(content: MessageContent): ComplexResponse[] {
    if (typeof content === 'string') {
        return [{
            type: "text",
            text: content
        }];
    }

    return (content as MessageContentComplex[]).map(c => {
        if (c.type === "text") {
            return {
                type: "text"  as const,
                text: (c as MessageContentText).text
            } as ResponseContentText;
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
            } as ResponseContentImage;
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
