import { CompiledStateGraph, Command,  StateDefinition, StateSchema, MessagesValue, BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentCommand, AgentPlugin } from "../plugins/index.js";
import { Agent, AgentMessageToolRequest, AgentResponse, AgentUserMessageResponse, AgentWorkspace, CommandRequest, InputAgentMessage, IntermediateAgentMessage, SharedFile } from "./index.js";
import { AIMessageChunk, BaseMessage, HumanMessage,  RemoveMessage, ToolMessage } from "@langchain/core/messages";
import { v4 } from "uuid";
import { complexResponseToLangchainMessageContent, extractAllTextFromComplexResponse } from "../utils/format.js";
import { commandContentToBaseMessage, lCmessageContentToContent } from "./message-utils.js";
import { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt";
import { USER_RESPONSE_MARKER } from "../utils/instruction-mapper.js";
import z from "zod";



export const AgentState = new StateSchema({
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
    graph: AgentGraphType
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
    async *call(args: { message: InputAgentMessage | null; sessionId: string, checkpointId?: string; noMessagesInTool?: boolean; }): AsyncGenerator<IntermediateAgentMessage, { message: AgentResponse; checkpointId: string; }, unknown> {

        let stateConfig = {
            streamMode: ["messages" as const, "values" as const],
        };
        let graphInput: any = null;
        const state = await this.graph.getState({ ...stateConfig, configurable: {  thread_id: `${args.sessionId}#${this.name}` } });
        if (state.next.length > 0 && state.next[0] === "human_review_node") {
            if (args.message) {
                graphInput = new Command({ resume: { type: "response", args: extractAllTextFromComplexResponse(args.message.content) } satisfies HumanResponse })
            } else {
                graphInput = new Command({ resume: { type: "accept", args: null } satisfies HumanResponse })
            }

        }
        else {
            graphInput = args.message != null ? {
                messages: [new HumanMessage({
                    id: v4(),
                    content: complexResponseToLangchainMessageContent(args.message.content),
                    additional_kwargs: {
                        sharedFiles: args.message.sharedFiles
                    }
                })],
                requestAttributes: {},
                responseAttributes: {},
                noMessagesInTool: args.noMessagesInTool ?? false,
            } : null;
        }

        let generator = this.executeGraph(graphInput, args.sessionId,  args.checkpointId);
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
    async *handleCommand(args: { command: CommandRequest; sessionId: string,  }): AsyncGenerator<IntermediateAgentMessage, { message: AgentResponse; checkpointId: string; }, unknown> {
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

        let generator = this.executeGraph(graphInput, args.sessionId);
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

    async shutDown(){
        await Promise.all(this.args.plugins.map(async plugin => await plugin.destroy()));
    }

    async reset(args: { sessionId: string,  checkpointId?: string; }): Promise<void> {
        let stateConfig = {
            streamMode: ["messages" as const, "values" as const],
        };

        const allList = (this.graph.checkpointer as BaseCheckpointSaver).list({})
        for await (const i of allList) {
            console.log(JSON.stringify(i))
        }
//         await Promise.all(this.args.plugins.map(async plugin => await plugin.reset()));
//         await this.args.workspace.reset();
// //        const iter = this.graph.getStateHistory({ ...stateConfig, configurable: { thread_id: `${args.threadId}` } });
//         // for await (const i of iter) {
//         //     console.log(JSON.stringify(i))
//         // }

//         const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: `${args.threadId}` } });
//         const messages: BaseMessage[] = state.values["messages"] ?? [];
//         const messagesToRemove = messages.map((m) => new RemoveMessage({ id: m.id! }));
//        // (this.graph.checkpointer! as BaseCheckpointSaver).deleteThread
//         await this.graph.updateState({ ...stateConfig, configurable: { thread_id: `${args.threadId}` } }, { messages: messagesToRemove })
    }

    async *executeGraph(graphInput: any, sessionId: string,  checkpointId?: string ): AsyncGenerator<IntermediateAgentMessage, AgentResponse, unknown> {
        let stateConfig = {
            streamMode: ["messages" as const, "values" as const, "checkpoints" as const],
        };
        let lastKnownMessage: BaseMessage | undefined = undefined;
        let canStreamToUser = false;
        let streamMarkerBuffer = "";
        let hasStreamedAnyUserText = false;

        const getMessageChunkToStream = (chunkText: string): string => {
            if (!chunkText) {
                return "";
            }

            if (canStreamToUser) {
                if (hasStreamedAnyUserText) {
                    return chunkText;
                }
                const trimmedText = chunkText.trimStart();
                if (trimmedText.length > 0) {
                    hasStreamedAnyUserText = true;
                }
                return trimmedText;
            }

            streamMarkerBuffer += chunkText;
            const markerIndex = streamMarkerBuffer.indexOf(USER_RESPONSE_MARKER);
            if (markerIndex === -1) {
                const markerCarryLength = Math.max(USER_RESPONSE_MARKER.length - 1, 0);
                if (streamMarkerBuffer.length > markerCarryLength) {
                    streamMarkerBuffer = streamMarkerBuffer.slice(-markerCarryLength);
                }
                return "";
            }

            canStreamToUser = true;
            const textAfterMarker = streamMarkerBuffer.slice(markerIndex + USER_RESPONSE_MARKER.length).trimStart();
            streamMarkerBuffer = "";
            if (textAfterMarker.length > 0) {
                hasStreamedAnyUserText = true;
            }
            return textAfterMarker;
        };

        while (true) {
            let stream = await this.graph.stream(graphInput, { ...stateConfig, configurable: { thread_id:`${sessionId}#${this.name}`,  checkpoint_id: checkpointId } });
            for await (const state of stream) {
                if (state[0] === "messages"){
                    let messageState = state[1];
                    const baseMessage = messageState[0];
                    if (baseMessage.type === "ai") {
                        const textToStream = getMessageChunkToStream(baseMessage.text);
                        if (!textToStream) {
                            continue;
                        }
                        yield {
                            type: "messageChunk",
                            id: baseMessage.id!,
                            content: [
                                {
                                    type: "text",
                                    text: textToStream
                                }
                            ]
                        }
                    }
                }
                else if (state[0] === "values") {
                    let messageState = state[1];
                    
                    if ((messageState.messages?.length ?? 0 )> 0) {
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

            const state = await this.graph.getState({ ...stateConfig, configurable: {  thread_id: `${sessionId}#${this.name}` } });
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
                    sharedFiles: lastMessage.additional_kwargs["shared_files"]  as SharedFile[] ?? []
                },
                responseAttributes: responseAttributes
            } satisfies AgentUserMessageResponse
        }
    }

}
