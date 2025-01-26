import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ComplexResponse, } from "../schema.js";
import { Tool } from "@langchain/core/tools";
import { WorkspacePluginFactory } from "../plugins/workspace.js";
import { ViewPluginFactory } from "../tools/image_view.js";
import { MimirToolToLangchainTool } from "../utils/wrapper.js";
import { isToolMessage, ToolMessage } from "@langchain/core/messages/tool";
import { aiMessageToMimirAiMessage, complexResponseToLangchainMessageContent } from "../utils/format.js";
import { AIMessage, BaseMessage, HumanMessage, isAIMessage, isHumanMessage, MessageContentComplex, MessageContentText, RemoveMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, Command, END, interrupt, Messages, MessagesAnnotation, messagesStateReducer, Send, START, StateDefinition, StateGraph } from "@langchain/langgraph";
import { v4 } from "uuid";
import { extractTextResponseFromMessage, ResponseFieldMapper } from "../utils/instruction-mapper.js";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { commandContentToBaseMessage, dividerSystemMessage, langChainHumanMessageToMimirHumanMessage, langChainToolMessageToMimirHumanMessage, lCmessageContentToContent, mergeSystemMessages, parseToolMessage, toolMessageToToolResponseInfo } from "./message-utils.js";
import { LangchainToolWrapperPluginFactory } from "./langchain-wrapper.js";
import { Agent, AgentMessage, AgentMessageToolRequest, AgentUserMessageResponse, WorkspaceFactory } from "./index.js";
import { AgentSystemMessage, AttributeDescriptor, MimirAgentPlugin, MimirPluginFactory, NextMessageUser } from "../plugins/index.js";


export const StateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    requestAttributes: Annotation<Record<string, any>>,
    responseAttributes: Annotation<Record<string, any>>,
    output: Annotation<AgentMessage>,
    noMessagesInTool: Annotation<Boolean>,
    agentMessage: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
});

export type CreateAgentOptions = {
    profession: string,
    description: string,
    name: string,
    model: BaseChatModel,
    plugins?: MimirPluginFactory[],
    constitution?: string,
    visionSupport?: 'openai'
    tools?: Tool[],
    workspaceFactory: WorkspaceFactory,
}


export async function createAgent(config: CreateAgentOptions): Promise<Agent> {

    const shortName = config.name;
    const model = config.model;
    const workspace = await config.workspaceFactory(shortName);
    const allPluginFactories = (config.plugins ?? []);

    const tools = [
        ...(config.tools ?? []),
    ];
    const toolPlugins: MimirPluginFactory[] = [...tools.map(tool => new LangchainToolWrapperPluginFactory(tool))];
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
    const agentCallCondition = async (state: typeof StateAnnotation.State) => {
        if (state.agentMessage.length > 0) {
            return state.agentMessage.map(am => {
                return new Send("agent_call", am);
            })
        }
        return "call_llm";
    }
    const agentCall = async (state: ToolMessage) => {
        const agenrM = state;
        const aum: AgentMessageToolRequest = JSON.parse(agenrM.content as string);
        const response: AgentUserMessageResponse = {
            type: "agentResponse",
            output: aum,
            responseAttributes: {}
        }
        const humanReview = interrupt<
            AgentUserMessageResponse,
            {
                response: ComplexResponse[];
            }>(response);


        const toolResponse = new ToolMessage({
            id: v4(),
            name: agenrM.name,
            tool_call_id: agenrM.tool_call_id,
            content: complexResponseToLangchainMessageContent(humanReview.response)

        })
        return { messages: [toolResponse], agentMessage: [new RemoveMessage({ id: agenrM.id! })] };

    }


    const callLLm = () => {
        return async (state: typeof StateAnnotation.State) => {

            const lastMessage: BaseMessage = state.messages[state.messages.length - 1];

            if (isAIMessage(lastMessage)) {
                return {}
            }

            let nextMessage = isHumanMessage(lastMessage) ?
                langChainHumanMessageToMimirHumanMessage(lastMessage) : isToolMessage(lastMessage) ?
                    langChainToolMessageToMimirHumanMessage(lastMessage) : undefined;
            await Promise.all(allCreatedPlugins.map(p => p.readyToProceed(nextMessage!, state)));



            const pluginAttributes = (await Promise.all(
                allCreatedPlugins.map(async (plugin) => await plugin.attributes(state))
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
            let messageToStore: BaseMessage;
            if (isHumanMessage(lastMessage)) {
                const nextMessage = langChainHumanMessageToMimirHumanMessage(lastMessage);
                const { displayMessage, persistentMessage } = await addAdditionalContentToUserMessage(nextMessage, allCreatedPlugins, state);

                const messageListToSend = state.messages.slice(0, -1);
                messageListToSend.push(new HumanMessage({
                    id: lastMessage.id,
                    content: complexResponseToLangchainMessageContent(displayMessage.content)
                }));
                messageToStore = new HumanMessage({
                    id: lastMessage.id,
                    content: complexResponseToLangchainMessageContent(persistentMessage.content)
                });

                const pluginInputs = (await Promise.all(
                    allCreatedPlugins.map(async (plugin) => await plugin.getSystemMessages(state))
                ));
                const systemMessage = buildSystemMessage([...pluginInputs, responseFormatSystemMessage]);
                response = await modelWithTools.invoke([systemMessage, ...messageListToSend]);

            } else {

                messageToStore = lastMessage;
                const pluginInputs = (await Promise.all(
                    allCreatedPlugins.map(async (plugin) => await plugin.getSystemMessages(state))
                ));
                const systemMessage = buildSystemMessage([...pluginInputs, responseFormatSystemMessage]);
                response = await modelWithTools.invoke([systemMessage, ...state.messages]);
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
            let mimirAiMessage = aiMessageToMimirAiMessage(response);
            const rawResponseAttributes = await fieldMapper.readInstructionsFromResponse(mimirAiMessage.content);

            const responseAttributes = (await Promise.all(
                allCreatedPlugins.map(async (plugin) => await plugin.readResponse(mimirAiMessage, state, rawResponseAttributes))
            )).reduce((acc, d) => ({ ...acc, ...d }), {});

            return { messages: [messageToStore, response], requestAttributes: {}, responseAttributes: responseAttributes };
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

    function humanReviewNode(state: typeof MessagesAnnotation.State) {
        const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
        const toolCall = lastMessage.tool_calls![lastMessage.tool_calls!.length - 1];
        const toolRequest: AgentMessage = parseToolMessage(lastMessage, {});
        const humanReview = interrupt<
            AgentMessage,
            {
                action: string;
                data: ComplexResponse[];
            }>(toolRequest);


        const reviewAction = humanReview.action;
        const reviewData = humanReview.data;

        // Approve the tool call and continue
        if (reviewAction === "continue") {
            return new Command({ goto: "run_tool" });
        } else if (reviewAction === "feedback") {
            const toolMessage = new ToolMessage({
                id: v4(),
                name: toolCall.name,
                content: [
                    { type: "text", text: `The user has cancelled the execution of this function as instead has given you the following feedback:\n` },
                    ...complexResponseToLangchainMessageContent(reviewData)
                ],
                tool_call_id: toolCall.id!
            })
            return new Command({ goto: "call_llm", update: { messages: [toolMessage] } });
        }
        throw new Error("Unreachable");
    }

    function outputConvert(state: typeof StateAnnotation.State) {

        if (state["messages"] && state["messages"].length > 0) {
            const aiMessage: AIMessage = state["messages"][state["messages"].length - 1];
            const responseAttributes: Record<string, any> = state["responseAttributes"];

            const content = lCmessageContentToContent(aiMessage.content);
            let agentMessage: AgentMessage = { content: extractTextResponseFromMessage(content) };
            return { output: agentMessage }
        }
        return {}
    }

    const workflow = new StateGraph(StateAnnotation)
        .addNode("call_llm", callLLm())
        .addNode("run_tool", new ToolNode(langChainTools, { handleToolErrors: true }))
        .addNode("human_review_node", humanReviewNode, {
            ends: ["run_tool", "call_llm"]
        })
        .addNode("output_convert", outputConvert)
        .addNode("agent_call", agentCall)
        .addEdge(START, "call_llm")
        .addConditionalEdges(
            "call_llm",
            routeAfterLLM,
            ["human_review_node", "output_convert"]
        )
        .addConditionalEdges("run_tool", agentCallCondition, ["agent_call", "call_llm"])
        .addEdge("agent_call", "call_llm")
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
        await Promise.all(allCreatedPlugins.map(async plugin => await plugin.clear()));
        await workspace.reset();
        const state = await graph.getState(stateConfig);
        const messages: BaseMessage[] = state.values["messages"] ?? [];
        const messagesToRemove = messages.map((m) => new RemoveMessage({ id: m.id! }));

        const agentMessage: BaseMessage[] = state.values["agentMessage"] ?? [];
        const agentMessagesToRemove = agentMessage.map((m) => new RemoveMessage({ id: m.id! }));
        await graph.updateState(stateConfig, { messages: messagesToRemove, agentMessage: agentMessagesToRemove }, "output_convert")
    };


    return {
        name: shortName,
        description: config.description,
        commands: commandList,
        workspace: workspace,
        reset: reset,
        handleCommand: async function* (command) {

            let commandHandler = commandList.find(ac => ac.name == command.name)!
            let newMessages = await commandHandler.commandHandler(command.arguments ?? {});
            let msgs = newMessages.map(mc => commandContentToBaseMessage(mc));
            let graphInput: any = null;
            graphInput = {
                messages: msgs,
                requestAttributes: {},
                responseAttributes: {}
            };


            while (true) {
                let stream = await graph.stream(graphInput, stateConfig);
                let lastKnownMessage: ToolMessage | undefined = undefined;
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

                if (state.tasks.length > 0 && state.tasks[0].name === "agent_call") {
                    const interruptState = state.tasks[0].interrupts[0];
                    return interruptState.value as AgentUserMessageResponse

                }

                let userResponse = (state.values["output"] as AgentMessage);
                return {
                    type: "agentResponse",
                    output: userResponse,
                    responseAttributes: responseAttributes
                } as AgentUserMessageResponse
            }

        },
        call: async function* (message, input, noMessagesInTool) {

            let graphInput: any = null;
            const state = await graph.getState(stateConfig);
            if (state.next.length > 0 && state.next[0] === "human_review_node") {
                if (message) {
                    graphInput = new Command({ resume: { action: "feedback", data: message } })
                } else {
                    graphInput = new Command({ resume: { action: "continue" } })
                }

            }
            else if (state.next.length > 0 && state.next[0] === "agent_call") {
                graphInput = new Command({ resume: { response: message } })
            }
            else {

                graphInput = message != null ? {
                    messages: [new HumanMessage({
                        id: `${v4()}`,
                        content: complexResponseToLangchainMessageContent(message)
                    })],
                    requestAttributes: input,
                    responseAttributes: {},
                    noMessagesInTool: noMessagesInTool ?? false,
                } : null;
            }

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

                if (state.tasks.length > 0 && state.tasks[0].name === "agent_call") {
                    const interruptState = state.tasks[0].interrupts[0];
                    return interruptState.value as AgentUserMessageResponse

                }

                let userResponse = (state.values["output"] as AgentMessage);
                return {
                    type: "agentResponse",
                    output: userResponse,
                    responseAttributes: responseAttributes
                } as AgentUserMessageResponse
            }
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


async function addAdditionalContentToUserMessage(message: NextMessageUser, plugins: MimirAgentPlugin[], state: typeof StateAnnotation.State) {
    const displayMessage = JSON.parse(JSON.stringify(message)) as NextMessageUser;
    const persistentMessage = JSON.parse(JSON.stringify(message)) as NextMessageUser;
    const spacing: ComplexResponse = {
        type: "text",
        text: "\n-----------------------------------------------\n\n"
    }
    const additionalContent: ComplexResponse[] = [];
    const persistentAdditionalContent: ComplexResponse[] = [];
    for (const plugin of plugins) {
        const customizations = await plugin.additionalMessageContent(persistentMessage, state,);
        for (const customization of customizations) {
            if (customization.displayOnCurrentMessage) {
                additionalContent.push(...customization.content)
                additionalContent.push(spacing)
            }
            if (customization.saveToChatHistory) {
                persistentAdditionalContent.push(...customization.content);
                persistentAdditionalContent.push(spacing)
            }
        }
    }
    displayMessage.content.unshift(...additionalContent);
    persistentMessage.content.unshift(...persistentAdditionalContent);

    return {
        displayMessage,
        persistentMessage
    }
}