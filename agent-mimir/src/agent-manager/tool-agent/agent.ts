import { ComplexMessageContent, } from "../../schema.js";
import { WorkspacePluginFactory, WorkspanceManager } from "../../plugins/workspace.js";
import { ViewPluginFactory } from "../../tools/image_view.js";
import { MimirToolToLangchainTool } from "./wrapper.js";
import { isToolMessage, ToolMessage } from "@langchain/core/messages/tool";
import { complexResponseToLangchainMessageContent, trimAndAsnitizeMessageContent } from "../../utils/format.js";
import { AIMessage, BaseMessage, HumanMessage, MessageContentComplex, MessageContentText, RemoveMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, Command, END, interrupt, Messages, MessagesAnnotation, messagesStateReducer, START, StateDefinition, StateGraph } from "@langchain/langgraph";
import { v4 } from "uuid";
import { ResponseFieldMapper } from "../../utils/instruction-mapper.js";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { commandContentToBaseMessage, dividerSystemMessage, lCmessageContentToContent, mergeSystemMessages } from "../message-utils.js";
import { Agent, AgentMessageToolRequest, AgentResponse, AgentUserMessageResponse, InputAgentMessage, ToolResponseInfo, WorkspaceFactory } from "../index.js";
import { AgentSystemMessage, AttributeDescriptor, AgentPlugin, PluginFactory, AiResponseMessage } from "../../plugins/index.js";
import { toolNodeFunction } from "./tool-node.js"
import { aiMessageToMimirAiMessage, langChainToolMessageToMimirHumanMessage, toolMessageToToolResponseInfo } from "./utils.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export const StateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    requestAttributes: Annotation<Record<string, any>>,
    responseAttributes: Annotation<Record<string, any>>,
    output: Annotation<AiResponseMessage>,
    input: Annotation<InputAgentMessage | null>,
    noMessagesInTool: Annotation<Boolean>,
    agentMessage: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
});

/**
 * Configuration options for creating a new agent.
 * Contains all necessary parameters to initialize an agent with its capabilities.
 */
export type CreateAgentArgs = {
    /** The professional role or expertise of the agent */
    profession: string,
    /** A description of the agent's purpose and capabilities */
    description: string,
    /** The unique name identifier for the agent */
    name: string,
    /** The language model to be used by the agent */
    model: BaseChatModel,
    /** Optional array of plugin factories to extend agent functionality */
    plugins?: PluginFactory[],
    /** Optional constitution defining agent behavior guidelines */
    constitution?: string,
    /** Optional vision support type (currently only supports 'openai') */
    visionSupport?: 'openai',
    /** Factory function to create the agent's workspace */
    workspaceFactory: WorkspaceFactory,
}




export async function createAgent(config: CreateAgentArgs): Promise<Agent> {

    const shortName = config.name;
    const model = config.model;
    const workspace = await config.workspaceFactory(shortName);
    const allPluginFactories = (config.plugins ?? []);

    const toolPlugins: PluginFactory[] = [];
    toolPlugins.push(new WorkspacePluginFactory());
    toolPlugins.push(new ViewPluginFactory());
    const allCreatedPlugins = await Promise.all([...allPluginFactories, ...toolPlugins].map(async factory => await factory.create({
        workspace: workspace,
        agentName: shortName,
        persistenceDirectory: await workspace.pluginDirectory(factory.name),
    })));


    const allTools = (await Promise.all(allCreatedPlugins.map(async plugin => await plugin.tools()))).flat();

    const langChainTools = allTools.map(t => new MimirToolToLangchainTool(t));
    const modelWithTools = model.bindTools!(langChainTools);
    const defaultAttributes: AttributeDescriptor[] = [

    ]

    const workspaceManager = new WorkspanceManager(workspace)

    const callLLm = () => {
        return async (state: typeof StateAnnotation.State) => {

            const lastMessage: BaseMessage = state.messages[state.messages.length - 1];
            const inputMessage = state.input;


            let nextMessage = inputMessage !== null ?
                {
                    type: "USER_MESSAGE" as const,
                    ...inputMessage
                } : isToolMessage(lastMessage) ?
                    langChainToolMessageToMimirHumanMessage(lastMessage) : undefined;

            if (nextMessage === undefined) {
                throw new Error("No next message found");
            }
            await Promise.all(allCreatedPlugins.map(p => p.readyToProceed(nextMessage!)));



            const pluginAttributes = (await Promise.all(
                allCreatedPlugins.map(async (plugin) => await plugin.attributes(nextMessage!))
            )).flatMap(e => e);
            const fieldMapper = new ResponseFieldMapper([...pluginAttributes, ...defaultAttributes]);
            const responseFormatSystemMessage: AgentSystemMessage = {
                content: [
                    {
                        text: fieldMapper.createFieldInstructions(),
                        type: "text"
                    }
                ]
            }

            let response: AIMessage;
            let messageToStore: BaseMessage[] = [];
            if (inputMessage) {
                await workspaceManager.loadFiles(inputMessage);
                const { displayMessage, persistentMessage } = await addAdditionalContentToUserMessage(inputMessage, allCreatedPlugins);

                displayMessage.content = trimAndAsnitizeMessageContent(displayMessage.content);
                persistentMessage.message.content = trimAndAsnitizeMessageContent(persistentMessage.message.content);

                const messageListToSend = [...state.messages];
                messageListToSend.push(new HumanMessage({
                    id: v4(),
                    content: complexResponseToLangchainMessageContent(displayMessage.content)
                }));
                messageToStore = [new HumanMessage({
                    response_metadata: {
                        persistentMessageRetentionPolicy: persistentMessage.retentionPolicy
                    },
                    id: v4(),
                    content: complexResponseToLangchainMessageContent(persistentMessage.message.content)
                })];

                const pluginInputs = (await Promise.all(
                    allCreatedPlugins.map(async (plugin) => await plugin.getSystemMessages())
                ));
                const systemMessage = buildSystemMessage([responseFormatSystemMessage, ...pluginInputs]);
                response = await modelWithTools.invoke([systemMessage, ...messageListToSend]);

            } else {
                const messageListToSend = [...state.messages];
                if (isToolMessage(lastMessage) && ((lastMessage)).status !== "error") {
                    const { displayMessage, persistentMessage } = await addAdditionalContentToUserMessage({ content: [] }, allCreatedPlugins);
                    displayMessage.content = trimAndAsnitizeMessageContent(displayMessage.content);
                    persistentMessage.message.content = trimAndAsnitizeMessageContent(persistentMessage.message.content);
    
                    if (displayMessage.content.length > 0) {
                        messageListToSend.push(new HumanMessage({
                            id: v4(),
                            content: [
                                {
                                    type: "text",
                                    text: "Tools invoked succesfully (unless a tool call told you it failed or was cancelled), continue please but be sure the results from the tools are correct and what you expected."
                                },
                                ...complexResponseToLangchainMessageContent(displayMessage.content)
                            ]
                        }));
                    }
                    if (persistentMessage.message.content.length > 0) {
                        messageToStore = [new HumanMessage({
                            id: v4(),
                            response_metadata: {
                                persistentMessageRetentionPolicy: persistentMessage.retentionPolicy
                            },
                            content: complexResponseToLangchainMessageContent(persistentMessage.message.content)
                        })];
                    }
                }

                const pluginInputs = (await Promise.all(
                    allCreatedPlugins.map(async (plugin) => await plugin.getSystemMessages())
                ));
                const systemMessage = buildSystemMessage([responseFormatSystemMessage, ...pluginInputs]);
                response = await modelWithTools.invoke([systemMessage, ...messageListToSend]);
            }

            // Claude sometimes likes to respond with empty messages when there is no more content to send
            if (response.content.length === 0 && response.tool_calls?.length === 0) {
                response = new AIMessage({
                    id: response.id,
                    content: [{
                        type: "text",
                        text: "I have completed my task.",
                    }],
                    tool_calls: response.tool_calls
                })
            }
            //Agents calling agents cannot see the messages from the tool, so we remove them so the AI doesn't think it has already responded.
            if ((response.tool_calls?.length ?? 0 > 0) && state.noMessagesInTool) {
                if (Array.isArray(response.content)) {
                    response = new AIMessage({
                        id: response.id,
                        content: [...response.content.filter(e => e.type !== "text")],
                        tool_calls: response.tool_calls
                    })
                } else {
                    response = new AIMessage({
                        id: response.id,
                        content: [],
                        tool_calls: response.tool_calls
                    })
                }
            }
            const messageContent = lCmessageContentToContent(response.content);
            const rawResponseAttributes = await fieldMapper.readInstructionsFromResponse(messageContent);
            const sharedFiles = await workspaceManager.readAttributes(rawResponseAttributes);
            let mimirAiMessage = aiMessageToMimirAiMessage(response, sharedFiles, fieldMapper);

            for (const plugin of allCreatedPlugins) {
                await plugin.readResponse(mimirAiMessage, rawResponseAttributes);
            }

            return {
                messages: [...messageToStore, response],
                requestAttributes: {},
                output: mimirAiMessage,
                responseAttributes: rawResponseAttributes,
                input: null
            };
        };
    }


    function routeAfterLLM(
        state: typeof MessagesAnnotation.State,
    ): "output_convert" | "human_review_node" {
        const lastMessage: AIMessage = state.messages[state.messages.length - 1];

        if (
            (lastMessage as AIMessage).tool_calls?.length === 0
        ) {
            return "output_convert";
        } else {
            return "human_review_node";
        }
    }

    async function messageRetentionNode(state: typeof MessagesAnnotation.State) {
        const modifiedMessages: BaseMessage[] = [];

        // Get messages with a persistent retention policy and reverse the order
        const messagesWithRetention = state.messages
            .filter(m => m.response_metadata?.persistentMessageRetentionPolicy)
            .reverse();

        // Iterate over messages with retention policies
        for (const [idx, message] of messagesWithRetention.entries()) {
            const retentionPolicy = message.response_metadata!.persistentMessageRetentionPolicy;
            const messageContent = message.content as MessageContentComplex[];

            // Map content with its corresponding retention value and filter those
            // whose retention is either null or greater than the current idx.
            const filteredContentWithRetention = messageContent.map((content, index) => ({
                content,
                retention: retentionPolicy[index]
            })).filter(({ retention }) => retention === null || (retention !== null && retention > idx));

            // If the content was modified drop the unwanted elements
            if (filteredContentWithRetention.length < messageContent.length) {
                const updatedContent = filteredContentWithRetention.map(item => item.content);
                const updatedRetention = filteredContentWithRetention.map(item => item.retention);

                if (updatedContent.length > 0) {
                    modifiedMessages.push(new HumanMessage({
                        id: message.id!,
                        content: updatedContent,
                        response_metadata: {
                            ...message.response_metadata,
                            persistentMessageRetentionPolicy: updatedRetention
                        }
                    }));
                } else {
                    modifiedMessages.push(new RemoveMessage({
                        id: message.id!,
                    }));
                }

            }
        }
        return { messages: modifiedMessages };
    }
    async function humanReviewNode(state: typeof StateAnnotation.State) {
        //const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
        const toolRequest: AgentMessageToolRequest = state.output;
        toolRequest.content
        const humanReview = interrupt<
            AgentMessageToolRequest,
            {
                action: string;
                data: InputAgentMessage;
            }>(toolRequest);


        const reviewAction = humanReview.action;
        const reviewData = humanReview.data;
        const name = modelWithTools.getName();
        // Approve the tool call and continue
        if (reviewAction === "continue") {
            return new Command({ goto: "run_tool" });
        } else if (reviewAction === "feedback") {
            await workspaceManager.loadFiles(reviewData);

            //Claude forcefully needs a tool message after a tool call, so we need to send it a tool message with the feedback. Every other model can just receive a human message.
            if (name === "ChatAnthropic" || name === "ChatOpenAI") {
                const responseMessage = new ToolMessage({
                    id: v4(),
                    tool_call_id: toolRequest.toolCalls![0].id!,
                    content: [
                        { type: "text", text: `I have cancelled the execution of the tool calls and instead I am giving you the following feedback:\n` },
                        ...complexResponseToLangchainMessageContent(reviewData.content)
                    ],
                })
                return new Command({ goto: "call_llm", update: { messages: [responseMessage] } });
            } else {
                const responseMessage: InputAgentMessage = {
                    content: [
                        { type: "text", text: `I have cancelled the execution of the tool calls and instead I am giving you the following feedback:\n` },
                        ...(reviewData.content)
                    ],
                };
                return new Command({ goto: "call_llm", update: { input: responseMessage } });
            }
        }
        throw new Error("Unreachable");
    }

    function outputConvert(state: typeof StateAnnotation.State) {

        return {}
    }

    const workflow = new StateGraph(StateAnnotation)
        .addNode("call_llm", callLLm())
        .addNode("run_tool", toolNodeFunction(langChainTools, { handleToolErrors: true }))
        .addNode("message_prep", messageRetentionNode)
        .addNode("human_review_node", humanReviewNode, {
            ends: ["run_tool", "message_prep"]
        })
        .addNode("output_convert", outputConvert)

        .addEdge(START, "message_prep")
        .addConditionalEdges(
            "call_llm",
            routeAfterLLM,
            ["human_review_node", "output_convert"]
        )
        .addEdge("run_tool", "message_prep")
        .addEdge("message_prep", "call_llm")
        .addEdge("output_convert", END);

    for (const plugin of allCreatedPlugins) {
        await plugin.init();
    }

    const agentCommands = (await Promise.all(
        allCreatedPlugins.map(async (plugin) => {

            return {
                commands: await plugin.getCommands(),
                plugin: plugin
            }
        })
    ));

    const commandList = agentCommands.map(ac => ac.commands).flat();

    const memory = SqliteSaver.fromConnString(workspace.rootDirectory + "/agent-chat.db");

    let stateConfig = {
        configurable: { thread_id: "1" },
        streamMode: "values" as const,
    };
    const graph = workflow.compile({
        checkpointer: memory,
    });


    const reset = async () => {
        await Promise.all(allCreatedPlugins.map(async plugin => await plugin.reset()));
        await workspace.reset();
        const state = await graph.getState(stateConfig);
        const messages: BaseMessage[] = state.values["messages"] ?? [];
        const messagesToRemove = messages.map((m) => new RemoveMessage({ id: m.id! }));

        const agentMessage: BaseMessage[] = state.values["agentMessage"] ?? [];
        const agentMessagesToRemove = agentMessage.map((m) => new RemoveMessage({ id: m.id! }));
        await graph.updateState(stateConfig, { messages: messagesToRemove, agentMessage: agentMessagesToRemove }, "output_convert")
    };

    const executeGraph = async function* (graphInput: any): AsyncGenerator<ToolResponseInfo, AgentResponse, unknown> {

        let lastKnownMessage: ToolMessage | undefined = undefined;
        while (true) {
            let stream = await graph.stream(graphInput, stateConfig);
            for await (const state of stream) {
                if (state.messages.length > 0) {
                    const lastMessage = state.messages[state.messages.length - 1];
                    if (isToolMessage(lastMessage) && lastMessage.id !== (lastKnownMessage?.id)) {
                        lastKnownMessage = lastMessage;
                        yield toolMessageToToolResponseInfo(lastMessage);
                    }
                }
            }

            const state = await graph.getState(stateConfig);

            const responseAttributes: Record<string, any> = state.values["responseAttributes"];
            if (state.tasks.length > 0 && state.tasks[0].name === "human_review_node") {
                const interruptState = state.tasks[0].interrupts[0];
                return {
                    type: "toolRequest",
                    output: interruptState.value as AgentMessageToolRequest,
                    responseAttributes: responseAttributes
                }
            }

            let userResponse = (state.values["output"] as AgentMessageToolRequest);
            return {
                type: "agentResponse",
                output: userResponse,
                responseAttributes: responseAttributes
            } as AgentUserMessageResponse
        }
    }

    return {
        name: shortName,
        description: config.description,
        commands: commandList,
        workspace: workspace,
        reset: reset,
        handleCommand: async function* (args) {

            let commandHandler = commandList.find(ac => ac.name == args.command.name)!
            let newMessages = await commandHandler.commandHandler(args.command.arguments ?? {});

            let lastMessage = newMessages[newMessages.length - 1];
            newMessages = newMessages.slice(0, newMessages.length - 1);
            const lastMessageAsInputMessage: InputAgentMessage = {
                content: lastMessage.content
            };

            let msgs = newMessages.map(mc => commandContentToBaseMessage(mc));
            let graphInput: any = null;
            graphInput = {
                messages: msgs,
                input: lastMessageAsInputMessage,
                requestAttributes: {},
                responseAttributes: {}
            };

            let generator = executeGraph(graphInput);
            let result;
            while (!(result = await generator.next()).done) {
                yield result.value;
            }
            return result.value

        },
        call: async function* (args) {

            let graphInput: any = null;
            const state = await graph.getState(stateConfig);
            if (state.next.length > 0 && state.next[0] === "human_review_node") {
                if (args.message) {
                    graphInput = new Command({ resume: { action: "feedback", data: args.message } })
                } else {
                    graphInput = new Command({ resume: { action: "continue" } })
                }

            }
            else {

                graphInput = args.message != null ? {
                    input: args.message,
                    requestAttributes: {},
                    responseAttributes: {},
                    noMessagesInTool: args.noMessagesInTool ?? false,
                } : null;
            }

            let generator = executeGraph(graphInput);
            let result;
            while (!(result = await generator.next()).done) {
                yield result.value;
            }
            return result.value
        }
    }
}

function buildSystemMessage(agentSystemMessages: AgentSystemMessage[]) {
    const messages = agentSystemMessages.map((m) => {
        return mergeSystemMessages([dividerSystemMessage, new SystemMessage({ content: complexResponseToLangchainMessageContent(m.content) })])
    });

    const finalMessage = mergeSystemMessages(messages);
    const content = finalMessage.content as MessageContentComplex[];
    const containsOnlyText = content.find((f) => f.type !== "text") === undefined;
    if (containsOnlyText) {
        const systemMessageText = content.reduce((prev, next) => {
            return prev + (next as MessageContentText).text
        }, "");

        return new SystemMessage(systemMessageText);
    }
    return finalMessage;
}


async function addAdditionalContentToUserMessage(message: InputAgentMessage, plugins: AgentPlugin[]) {
    const displayMessage = JSON.parse(JSON.stringify(message)) as InputAgentMessage;
    const persistentMessage = JSON.parse(JSON.stringify(message)) as InputAgentMessage;
    const persistantMessageRetentionPolicy: (number | null)[] = [];
    const spacing: ComplexMessageContent = {
        type: "text",
        text: "\n-----------------------------------------------\n\n"
    }
    const additionalContent: ComplexMessageContent[] = [];
    const persistentAdditionalContent: ComplexMessageContent[] = [];
    const userContent = message.content;
    for (const plugin of plugins) {
        const customizations = await plugin.additionalMessageContent(persistentMessage,);
        for (const customization of customizations) {
            if (customization.displayOnCurrentMessage) {
                additionalContent.push(...customization.content)
                additionalContent.push(spacing)
            }
            if (customization.saveToChatHistory) {
                const retention = typeof customization.saveToChatHistory === "number" ? customization.saveToChatHistory : null;
                persistantMessageRetentionPolicy.push(...customization.content.map(() => retention));
                persistentAdditionalContent.push(...customization.content);
                persistentAdditionalContent.push(spacing)
                persistantMessageRetentionPolicy.push(retention); //This one is for spacing
            }
        }
    }
    displayMessage.content.unshift(...additionalContent);
    persistentMessage.content.unshift(...persistentAdditionalContent);
    //Add nulls to the retention policy for the user content
    persistantMessageRetentionPolicy.push(...userContent.map(() => null));

    return {
        displayMessage,
        persistentMessage: {
            message: persistentMessage,
            retentionPolicy: persistantMessageRetentionPolicy
        }
    }
}
