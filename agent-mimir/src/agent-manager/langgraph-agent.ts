import { CompiledStateGraph, StateType, Annotation, BinaryOperatorAggregate, Messages, Command } from "@langchain/langgraph";
import { AgentCommand, AgentPlugin, AiResponseMessage } from "../plugins/index.js";
import { Agent, AgentMessageToolRequest, AgentResponse, AgentUserMessageResponse, AgentWorkspace, CommandRequest, InputAgentMessage, IntermediateAgentMessage, OutputAgentMessage, ToolResponseInfo } from "./index.js";
import { BaseMessage, HumanMessage, RemoveMessage } from "@langchain/core/messages";
import { v4 } from "uuid";
import { complexResponseToLangchainMessageContent } from "../utils/format.js";
import { commandContentToBaseMessage } from "./message-utils.js";


export type LanggraphAgentArgs = {
    name: string,
    description: string,
    workspace: AgentWorkspace,
    commands: AgentCommand[],
    plugins: AgentPlugin[],
    graph: CompiledStateGraph<StateType<{
        output: typeof Annotation<AiResponseMessage>,
        messages: BinaryOperatorAggregate<BaseMessage[], Messages>
    }>, any, any>,
    toolMessageHandler: {
        isToolMessage: (message: BaseMessage) => boolean,
        messageToToolMessage: (message: BaseMessage) => ToolResponseInfo
    }
}


export class LanggraphAgent implements Agent {
    name: string ;
    description: string;
    workspace: AgentWorkspace;
    commands: AgentCommand[];
    graph: CompiledStateGraph<StateType<{
        output: typeof Annotation<AiResponseMessage>,
        messages: BinaryOperatorAggregate<BaseMessage[], Messages>
    }>, any, any>

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
                graphInput = new Command({ resume: { action: "feedback", data: args.message } })
            } else {
                graphInput = new Command({ resume: { action: "continue" } })
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
        await this.graph.updateState({ ...stateConfig, configurable: { thread_id: args.threadId } }, { messages: messagesToRemove }, "output_convert")
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
                    let messageState = state[1];
                    if (messageState.messages.length > 0) {
                        const lastMessage = messageState.messages[messageState.messages.length - 1];
                        if (this.args.toolMessageHandler.isToolMessage(lastMessage) && lastMessage.id !== (lastKnownMessage?.id)) {
                            lastKnownMessage = lastMessage;
                            yield {
                                type: "toolResponse",
                                toolResponse: this.args.toolMessageHandler.messageToToolMessage(lastMessage)
                            };
                        }
                    }
                }
            }

            const state = await this.graph.getState({ ...stateConfig, configurable: { thread_id: threadId } });

            const responseAttributes: Record<string, any> = state.values["responseAttributes"];
            if (state.tasks.length > 0 && state.tasks[0].name === "human_review_node") {
                const interruptState = state.tasks[0].interrupts[0];
                return {
                    type: "toolRequest",
                    output: interruptState.value as AgentMessageToolRequest,
                    responseAttributes: responseAttributes
                }
            }

            let userResponse = (state.values["output"] as OutputAgentMessage);
            return {
                type: "agentResponse",
                output: userResponse,
                responseAttributes: responseAttributes
            } satisfies AgentUserMessageResponse
        }
    }

}