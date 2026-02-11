import { CompiledStateGraph, StateType, BinaryOperatorAggregate, Messages, Command, END, StateDefinition, StateSchema, MessagesValue } from "@langchain/langgraph";
import { AgentCommand, AgentPlugin } from "../plugins/index.js";
import { Agent, AgentMessageToolRequest, AgentResponse, AgentUserMessageResponse, AgentWorkspace, CommandRequest, InputAgentMessage, IntermediateAgentMessage, SharedFile } from "./index.js";
import { BaseMessage, HumanMessage,  MessageStructure,  MessageToolSet,  MessageType,  RemoveMessage, ToolMessage } from "@langchain/core/messages";
import { v4 } from "uuid";
import { complexResponseToLangchainMessageContent, extractAllTextFromComplexResponse } from "../utils/format.js";
import { commandContentToBaseMessage, lCmessageContentToContent } from "./message-utils.js";
import { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt";
import z from "zod";

export const AgentState = new StateSchema({
   responseAttributes: z.record(z.string(), z.any()),
    noMessagesInTool: z.boolean(),
    messages: MessagesValue
});
export type LanggraphAgentArgs = {
    name: string,
    description: string,
    workspace: AgentWorkspace,
    commands: AgentCommand[],
    plugins: AgentPlugin[],
    graph: CompiledStateGraph<typeof AgentState["State"], any, any, typeof AgentState, typeof AgentState, StateDefinition, unknown, unknown, unknown>
}


export class LanggraphAgent implements Agent {
    name: string;
    description: string;
    workspace: AgentWorkspace;
    commands: AgentCommand[];
    graph: CompiledStateGraph<typeof AgentState["State"], any, any, typeof AgentState, typeof AgentState, StateDefinition, unknown, unknown, unknown>

    constructor(private args: LanggraphAgentArgs) {
        this.workspace = args.workspace;
        this.name = args.name;
        this.description = args.description;
        this.commands = args.commands;
        this.graph = args.graph;
    }
    async *call(args: { message: InputAgentMessage | null; threadId: string; noMessagesInTool?: boolean; }): AsyncGenerator<IntermediateAgentMessage, { message: AgentResponse; checkpointId: string; }, unknown> {

        let stateConfig = {
            streamMode: ["messages" as const, "values" as const],
        };
        let graphInput: any = null;
        const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: args.threadId } });
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
                    response_metadata: {
                        sharedFiles: args.message.sharedFiles
                    }
                })],
                requestAttributes: {},
                responseAttributes: {},
                noMessagesInTool: args.noMessagesInTool ?? false,
            } : null;
        }

        let generator = this.executeGraph(graphInput, args.threadId);
        let result;
        while (!(result = await generator.next()).done) {
            yield result.value;
        }

        const newState = await this.graph.getState({ ...stateConfig, configurable: { thread_id: args.threadId } });
        return {
            message: result.value,
            checkpointId: newState.config.configurable?.checkpoint_id ?? "N/A",
        }
    }
    async *handleCommand(args: { command: CommandRequest; threadId: string; }): AsyncGenerator<IntermediateAgentMessage, { message: AgentResponse; checkpointId: string; }, unknown> {
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

        let generator = this.executeGraph(graphInput, args.threadId);
        let result;
        while (!(result = await generator.next()).done) {
            yield result.value;
        }

        const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: args.threadId } });
        return {
            message: result.value,
            checkpointId: state.config.configurable?.checkpoint_id ?? "N/A",
        }
    }

    async reset(args: { threadId: string; checkpointId?: string; }): Promise<void> {
        let stateConfig = {
            streamMode: ["messages" as const, "values" as const],
        };
        await Promise.all(this.args.plugins.map(async plugin => await plugin.reset()));
        await this.args.workspace.reset();
        const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: args.threadId } });
        const messages: BaseMessage[] = state.values["messages"] ?? [];
        const messagesToRemove = messages.map((m) => new RemoveMessage({ id: m.id! }));
       await this.graph.updateState({ ...stateConfig, configurable: { thread_id: args.threadId } }, { messages: messagesToRemove })
    }



    async *executeGraph(graphInput: any, threadId: string): AsyncGenerator<IntermediateAgentMessage, AgentResponse, unknown> {
        let stateConfig = {
            streamMode: ["messages" as const, "values" as const],
        };
        let lastKnownMessage: BaseMessage | undefined = undefined;
        while (true) {
            let stream = await this.graph.stream(graphInput, { ...stateConfig, configurable: { thread_id: threadId } });
            for await (const state of stream) {
                if (state[0] === "values") {
                    const jj = state[1]
                    
                    let messageState = state[1] as this["graph"]["~RunInput"];
                    
                    if ((messageState.messages?.length ?? 0 )> 0) {
                        const lastMessage = messageState.messages[messageState.messages.length - 1];
                        if (ToolMessage.isInstance(lastMessage) && lastMessage.id !== (lastKnownMessage?.id)) {
                            lastKnownMessage = lastMessage;
                            yield {
                                type: "toolResponse",
                                toolResponse: {
                                    id: lastMessage.tool_call_id,
                                    name: lastMessage.name ?? "Unknown",
                                    response: lCmessageContentToContent(lastMessage.contentBlocks)
                                }
                            };
                        }
                    }
                }
            }

            const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: threadId } });
            const lastMessage = state.values.messages[state.values.messages.length - 1] as BaseMessage;
            const responseAttributes: Record<string, any> = state.values["responseAttributes"];
            if (state.tasks.length > 0 && state.tasks[0].name === "human_review_node") {
                const interruptState = state.tasks[0].interrupts[0];
                const interruptVal = interruptState.value as HumanInterrupt
                return {
                    type: "toolRequest",
                    output: {
                        content: lCmessageContentToContent(lastMessage.contentBlocks), id: lastMessage.id ?? "", toolCalls: [
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