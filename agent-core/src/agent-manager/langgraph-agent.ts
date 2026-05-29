import { CompiledStateGraph, Command, StateDefinition, StateSchema, MessagesValue, BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentCommand, AgentPlugin } from "../plugins/index.js";
import { Agent, AgentHydrationEvent, AgentInput, AgentMessageToolRequest, AgentNotificationInput, AgentResponse, AgentUserMessageResponse, AgentWorkspace, CommandRequest, InputAgentMessage, IntermediateAgentMessage, SharedFile } from "./index.js";
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { v4 } from "uuid";
import { complexResponseToLangchainMessageContent, extractAllTextFromComplexResponse } from "../utils/format.js";
import { commandContentToBaseMessage, lCmessageContentToContent } from "./message-utils.js";
import { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt";
import { ResponseFieldMapper, USER_RESPONSE_MARKER } from "../utils/instruction-mapper.js";
import z from "zod";



export const AgentState = new StateSchema({
    requestAttributes: z.record(z.string(), z.any()),
    responseAttributes: z.record(z.string(), z.any()),
    noMessagesInTool: z.boolean(),
    messages: MessagesValue
});
export type AgentGraphType = CompiledStateGraph<typeof AgentState["State"], any, any, typeof AgentState, typeof AgentState, StateDefinition, unknown, unknown, unknown>;

export type LanggraphAgentArgs = {
    name: string,
    description: string,
    workspace: AgentWorkspace,
    commands: AgentCommand[],
    plugins: AgentPlugin[],
    graph: AgentGraphType,
    fieldMapper: ResponseFieldMapper
}

type MaterializedAgentInput = {
    message: InputAgentMessage;
    additionalKwargs: Record<string, unknown>;
};

export function materializeAgentInput(input: AgentInput): MaterializedAgentInput {
    if (input.type === "user_message") {
        return {
            message: input.message,
            additionalKwargs: {
                sharedFiles: input.message.sharedFiles,
                runtimeInput: input
            }
        };
    }

    const message = buildNotificationProcessingMessage(input.notification);
    return {
        message,
        additionalKwargs: {
            sharedFiles: message.sharedFiles,
            runtimeInput: input
        }
    };
}

function buildNotificationProcessingMessage(notification: AgentNotificationInput): InputAgentMessage {
    const content: InputAgentMessage["content"] = [
        {
            type: "text",
            text:
                "The user explicitly asked you to process this pending plugin notification.\n\n" +
                "This is an automated plugin notification delivered because the user clicked process; " +
                "it is not direct user-authored chat text.\n\n" +
                "Review the notification below and decide what action, if any, should be taken. " +
                "This notification is not part of a new user request beyond this explicit processing action.\n\n"
        }
    ];
    const sharedFiles: SharedFile[] = [];
    const seenSharedFiles = new Set<string>();
    const header = [
        `Plugin: ${notification.pluginName}`,
        `Title: ${notification.title}`,
        notification.summary ? `Summary: ${notification.summary}` : undefined,
        "Content:"
    ].filter(Boolean).join("\n");

    content.push({ type: "text", text: `${header}\n` });
    if (notification.content.content.length > 0) {
        content.push(...notification.content.content);
    } else {
        content.push({ type: "text", text: "(No additional content.)" });
    }
    content.push({ type: "text", text: "\n\n" });

    for (const sharedFile of notification.content.sharedFiles ?? []) {
        const key = `${sharedFile.fileName}\n${sharedFile.url}`;
        if (seenSharedFiles.has(key)) {
            continue;
        }
        seenSharedFiles.add(key);
        sharedFiles.push(sharedFile);
    }

    return {
        content,
        sharedFiles
    };
}


export class LanggraphAgent implements Agent {
    name: string;
    description: string;
    workspace: AgentWorkspace;
    commands: AgentCommand[];
    graph: AgentGraphType

    constructor(private args: LanggraphAgentArgs) {
        this.workspace = args.workspace;
        this.name = args.name;
        this.description = args.description;
        this.commands = args.commands;
        this.graph = args.graph;
    }
    async *call(args: { input: AgentInput | null; sessionId: string, checkpointId?: string; noMessagesInTool?: boolean; requestAttributes?: Record<string, unknown>; abortSignal?: AbortSignal }): AsyncGenerator<IntermediateAgentMessage, { message: AgentResponse; checkpointId: string; }, unknown> {

        let stateConfig = {
            streamMode: ["messages" as const, "values" as const],
        };
        let graphInput: any = null;
        const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: `${args.sessionId}#${this.name}` } });
        if (state.next.length > 0 && state.next[0] === "human_review_node") {
            const update = { requestAttributes: args.requestAttributes ?? {} };
            if (args.input) {
                const { message } = materializeAgentInput(args.input);
                graphInput = new Command({ resume: { type: "response", args: extractAllTextFromComplexResponse(message.content) } satisfies HumanResponse, update })
            } else {
                graphInput = new Command({ resume: { type: "accept", args: null } satisfies HumanResponse, update })
            }

        }
        else {
            const materializedInput = args.input ? materializeAgentInput(args.input) : null;
            graphInput = materializedInput ? {
                messages: [new HumanMessage({
                    id: v4(),
                    content: complexResponseToLangchainMessageContent(materializedInput.message.content),
                    additional_kwargs: materializedInput.additionalKwargs
                })],
                requestAttributes: args.requestAttributes ?? {},
                responseAttributes: {},
                noMessagesInTool: args.noMessagesInTool ?? false,
            } : null;
        }

        let generator = this.executeGraph(graphInput, args.sessionId, args.checkpointId, args.abortSignal);
        let result;
        while (!(result = await generator.next()).done) {
            yield result.value;
        }

        const newState = await this.graph.getState({ ...stateConfig, configurable: { thread_id: `${args.sessionId}#${this.name}` } });
        return {
            message: result.value,
            checkpointId: newState.config.configurable?.checkpoint_id!,
        }
    }
    async *handleCommand(args: { command: CommandRequest; sessionId: string; abortSignal?: AbortSignal }): AsyncGenerator<IntermediateAgentMessage, { message: AgentResponse; checkpointId: string; }, unknown> {
        let stateConfig = {
            streamMode: ["messages" as const, "values" as const],
        };
        let commandHandler = this.args.commands.find(ac => ac.name == args.command.name)!
        let newMessages = await commandHandler.commandHandler(args.command.arguments ?? {});
        let msgs = newMessages.map(mc => commandContentToBaseMessage(mc));
        let graphInput: any = null;

        graphInput = {
            messages: msgs,
            requestAttributes: {},
            responseAttributes: {}
        };

        let generator = this.executeGraph(graphInput, args.sessionId, undefined, args.abortSignal);
        let result;
        while (!(result = await generator.next()).done) {
            yield result.value;
        }

        const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: `${args.sessionId}#${this.name}` } });
        return {
            message: result.value,
            checkpointId: state.config.configurable?.checkpoint_id ?? "N/A",
        }
    }

    async shutDown() {
        await Promise.all(this.args.plugins.map(async plugin => await plugin.destroy()));
    }

    async reset(args: { sessionId: string; }): Promise<void> {
        await Promise.all(this.args.plugins.map(async plugin => await plugin.reset()));
        await this.args.workspace.reset();

        const checkpointer = this.graph.checkpointer as BaseCheckpointSaver | boolean | undefined;
        if (checkpointer && checkpointer !== true) {
            await checkpointer.deleteThread(`${args.sessionId}#${this.name}`);
        }
    }


    async *executeGraph(graphInput: any, sessionId: string, checkpointId?: string, abortSignal?: AbortSignal): AsyncGenerator<IntermediateAgentMessage, AgentResponse, unknown> {
        let stateConfig = {
            streamMode: ["messages" as const, "values" as const, "checkpoints" as const],
        };
        let lastKnownMessage: BaseMessage | undefined = undefined;
        let canStreamToUser = false;
        let streamMarkerBuffer = "";
        let hasStreamedAnyUserText = false;
        let responseAttributes: Record<string, any> | undefined = undefined;

        const getMessageChunkToStream = async (chunkText: string): Promise<{ text: string, responseAttributes: Record<string, any> | undefined }> => {
            if (!chunkText) {
                return { text: "", responseAttributes: responseAttributes };
            }

            if (canStreamToUser) {
                if (hasStreamedAnyUserText) {
                    return { text: chunkText, responseAttributes: responseAttributes };
                }
                const trimmedText = chunkText.trimStart();
                if (trimmedText.length > 0) {
                    hasStreamedAnyUserText = true;
                }
                return { text: trimmedText, responseAttributes: responseAttributes };
            }

            streamMarkerBuffer += chunkText;
            const markerIndex = streamMarkerBuffer.indexOf(USER_RESPONSE_MARKER);
            if (markerIndex === -1) {
                return { text: "", responseAttributes: responseAttributes };
            }

            canStreamToUser = true;
            if (!responseAttributes) {
                responseAttributes = await this.args.fieldMapper.readInstructionsFromResponseString(streamMarkerBuffer);
            }
            const textAfterMarker = streamMarkerBuffer.slice(markerIndex + USER_RESPONSE_MARKER.length).trimStart();
            streamMarkerBuffer = "";
            if (textAfterMarker.length > 0) {
                hasStreamedAnyUserText = true;
            }
            return {
                text: textAfterMarker,
                responseAttributes
            };
        };

        while (true) {
            let stream = await this.graph.stream(graphInput, { ...stateConfig, signal: abortSignal, configurable: { thread_id: `${sessionId}#${this.name}`, checkpoint_id: checkpointId } });
            for await (const state of stream) {
                if (state[0] === "messages") {
                    let messageState = state[1];
                    const baseMessage = messageState[0];
                    if (baseMessage.type === "ai") {
                        const textToStream = await getMessageChunkToStream(baseMessage.text);
                        if (!textToStream) {
                            continue;
                        }
                        yield {
                            type: "messageChunk",
                            id: baseMessage.id!,
                            content: [
                                {
                                    type: "text",
                                    text: textToStream.text
                                }
                            ],
                            responseAttributes: textToStream.responseAttributes
                        }
                    }
                }
                else if (state[0] === "values") {
                    let messageState = state[1];

                    if ((messageState.messages?.length ?? 0) > 0) {
                        const lastMessage = messageState.messages[messageState.messages.length - 1];
                        if (ToolMessage.isInstance(lastMessage) && lastMessage.id !== (lastKnownMessage?.id)) {
                            lastKnownMessage = lastMessage;
                            yield {
                                type: "toolResponse",
                                id: lastMessage.tool_call_id,
                                toolResponse: {
                                    name: lastMessage.name ?? "Unknown",
                                    response: lCmessageContentToContent(lastMessage.contentBlocks)
                                }
                            };
                        }
                    }
                }
            }

            const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: `${sessionId}#${this.name}` } });
            const lastMessage = state.values.messages[state.values.messages.length - 1] as BaseMessage;
            const responseAttributes: Record<string, any> = state.values["responseAttributes"];
            if (state.tasks.length > 0 && state.tasks[0].name === "human_review_node") {
                const interruptState = state.tasks[0].interrupts[0];
                const interruptVal = interruptState.value as HumanInterrupt
                return {
                    checkpointId: state.config?.configurable?.checkpoint_id,
                    type: "toolRequest",
                    output: {
                        content: lCmessageContentToContent(lastMessage.contentBlocks),
                        id: lastMessage.id ?? "",
                        toolCalls: [
                            {
                                toolName: interruptVal.action_request.action,
                                input: JSON.stringify(interruptVal.action_request.args, null, 2)
                            }
                        ]
                    } satisfies AgentMessageToolRequest,
                    responseAttributes: responseAttributes
                }
            }
            return {
                checkpointId: state.config?.configurable?.checkpoint_id,
                type: "agentResponse",
                output: {
                    content: lCmessageContentToContent(lastMessage.contentBlocks),
                    id: lastMessage.id ?? v4(),
                    sharedFiles: lastMessage.additional_kwargs["shared_files"] as SharedFile[] ?? []
                },
                responseAttributes: responseAttributes
            } satisfies AgentUserMessageResponse
        }
    }

}
