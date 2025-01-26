import { v4 } from "uuid";
import { AIMessage, BaseMessage, HumanMessage, MessageContent, MessageContentComplex, MessageContentImageUrl, MessageContentText, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { AgentToolRequest, AgentUserMessage, ComplexResponse, NextMessageToolResponse, NextMessageUser } from "../schema.js";
import { CONSTANTS, ERROR_MESSAGES } from "./constants.js";
import { complexResponseToLangchainMessageContent } from "../utils/format.js";

export function toolMessageToToolResponseInfo(message: { name?: string, content: any }): { name: string, response: string } {
    return {
        name: message.name ?? "Unknown",
        response: trimStringToMaxWithEllipsis(JSON.stringify(message.content), CONSTANTS.MAX_TOOL_RESPONSE_LENGTH)
    };
}

export function trimStringToMaxWithEllipsis(str: string, max: number): string {
    return str.length > max ? str.substring(0, max) + "..." : str;
}

export function langChainHumanMessageToMimirHumanMessage(message: HumanMessage): NextMessageUser {
    return {
        type: "USER_MESSAGE",
        content: lCmessageContentToContent(message.content)
    };
}

export function langChainToolMessageToMimirHumanMessage(message: ToolMessage): NextMessageToolResponse {
    return {
        type: "TOOL_CALL",
        tool: message.name ?? "Unknown",
        toolCallId: message.tool_call_id,
        content: lCmessageContentToContent(message.content)
    };
}

export function parseUserMessage(aiMessage: AIMessage, responseAttributes: Record<string, any>): AgentUserMessage {
    const textContent = extractTextContent(aiMessage.content, responseAttributes);
    return { message: textContent };
}

export function parseToolMessage(aiMessage: AIMessage, responseAttributes: Record<string, any>): AgentToolRequest {
    const textContent = extractTextContent(aiMessage.content, responseAttributes);
    return {
        toolRequests: (aiMessage.tool_calls ?? []).map(t => ({
            toolName: t.name,
            toolArguments: JSON.stringify(t.args)
        })),
        message: textContent
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

function extractTextContent(content: MessageContent, responseAttributes: Record<string, any>): string {
    if (responseAttributes["messageToSend"]) {
        return responseAttributes["messageToSend"] as string;
    }

    if (typeof content === 'string') {
        return content;
    }

    return (content as MessageContentComplex[])
        .filter(e => e.type === "text")
        .map(e => (e as MessageContentText).text)
        .join("\n");
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
                type: "text",
                text: (c as MessageContentText).text
            };
        }
        
        if (c.type === "image_url") {
            const imgContent = c as MessageContentImageUrl;
            const imageUrl = typeof imgContent.image_url === 'string' ? 
                imgContent.image_url : 
                imgContent.image_url.url;
            
            return {
                type: "text",
                text: imageUrl
            };
        }
        
        throw new Error(ERROR_MESSAGES.UNSUPPORTED_CONTENT_TYPE(c.type ?? "unknown"));
    });
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
