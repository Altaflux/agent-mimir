import { v4 } from "uuid";
import { AIMessage, BaseMessage, ContentBlock, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ComplexMessageContent, ImageMessageContent, TextMessageContent } from "../schema.js";
import { CONSTANTS, ERROR_MESSAGES } from "./constants.js";
import { complexResponseToLangchainMessageContent } from "../utils/format.js";
import { AgentInput, InputAgentMessage, SharedFile } from "./index.js";


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

export function getHumanMessageSharedFiles(message: HumanMessage): SharedFile[] {
    return [
        ...(message.additional_kwargs?.["sharedFiles"] as SharedFile[] ?? []),
        ...(message.additional_kwargs?.["shared_files"] as SharedFile[] ?? [])
    ];
}

export function readRuntimeInput(message: HumanMessage): AgentInput | undefined {
    const input = message.additional_kwargs?.["runtimeInput"];
    if (!input || typeof input !== "object") {
        return undefined;
    }

    const maybeInput = input as Record<string, unknown>;
    if (maybeInput.type === "user_message" && isInputAgentMessage(maybeInput.message)) {
        return {
            type: "user_message",
            message: maybeInput.message
        };
    }

    if (maybeInput.type !== "plugin_notification" || !maybeInput.notification || typeof maybeInput.notification !== "object") {
        return undefined;
    }

    const notification = maybeInput.notification as Record<string, unknown>;
    if (
        typeof notification.notificationId !== "string" ||
        typeof notification.pluginName !== "string" ||
        typeof notification.title !== "string" ||
        !isInputAgentMessage(notification.content)
    ) {
        return undefined;
    }

    return {
        type: "plugin_notification",
        notification: {
            notificationId: notification.notificationId,
            pluginName: notification.pluginName,
            title: notification.title,
            message: typeof notification.message === "string" ? notification.message : undefined,
            content: notification.content
        }
    };
}

export function runtimeInputAdditionalKwargs(message: HumanMessage): Record<string, unknown> {
    const runtimeInput = readRuntimeInput(message);
    const runtimeMetadata: Record<string, unknown> = {};
    if (runtimeInput) {
        runtimeMetadata.runtimeInput = runtimeInput;
    }

    return runtimeMetadata;
}

function isInputAgentMessage(message: unknown): message is InputAgentMessage {
    if (!message || typeof message !== "object") {
        return false;
    }

    const maybeMessage = message as Record<string, unknown>;
    if (!Array.isArray(maybeMessage.content)) {
        return false;
    }

    return maybeMessage.sharedFiles === undefined || Array.isArray(maybeMessage.sharedFiles);
}


export function humanMessageToInputAgentMessage(message: HumanMessage): InputAgentMessage {
    return {
        content: lCmessageContentToContent(message.contentBlocks),
        sharedFiles: getHumanMessageSharedFiles(message)
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
