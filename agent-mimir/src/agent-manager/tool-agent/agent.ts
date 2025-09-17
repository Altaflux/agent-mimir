import { ComplexMessageContent, } from "../../schema.js";
import { WorkspacePluginFactory, WorkspanceManager } from "../../plugins/workspace.js";
import { ViewPluginFactory } from "../../tools/image_view.js";
import { MimirToolToLangchainTool } from "./wrapper.js";
import { isToolMessage, ToolMessage } from "@langchain/core/messages/tool";
import { complexResponseToLangchainMessageContent, trimAndSanitizeMessageContent } from "../../utils/format.js";
import { AIMessage, BaseMessage, HumanMessage, isHumanMessage, MessageContentComplex, MessageContentText, RemoveMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, BaseCheckpointSaver, Command, END, interrupt, MemorySaver, Messages, MessagesAnnotation, START, StateDefinition, StateGraph } from "@langchain/langgraph";
import { v4 } from "uuid";
import { ResponseFieldMapper } from "../../utils/instruction-mapper.js";
import { dividerSystemMessage, humanMessageToInputAgentMessage, lCmessageContentToContent, mergeSystemMessages } from "../message-utils.js";
import { Agent, WorkspaceFactory } from "../index.js";
import { AttributeDescriptor, PluginFactory } from "../../plugins/index.js";
import { toolNodeFunction } from "./tool-node.js"
import { aiMessageToMimirAiMessage, langChainHumanMessageToMimirHumanMessage, langChainToolMessageToMimirToolMessage } from "./utils.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { DEFAULT_CONSTITUTION } from "../constants.js";
import { PluginContextProvider } from "../../plugins/context-provider.js";
import { LanggraphAgent } from "../langgraph-agent.js";
import { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt";
export const StateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    responseAttributes: Annotation<Record<string, any>>,
    noMessagesInTool: Annotation<Boolean>
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

    checkpointer?: BaseCheckpointSaver
}




export async function createLgAgent(config: CreateAgentArgs) {

    const shortName = config.name;
    const model = config.model;
    const workspace = await config.workspaceFactory(shortName);
    const allPluginFactories = (config.plugins ?? []);

    const toolPlugins: PluginFactory[] = [];
    toolPlugins.push(new WorkspacePluginFactory());
    toolPlugins.push(new ViewPluginFactory());
    const allCreatedPlugins = await Promise.all([...allPluginFactories, ...toolPlugins].map(async factory => await factory.create({
        workspace: workspace,
    })));


    const allTools = (await Promise.all(allCreatedPlugins.map(async plugin => await plugin.tools()))).flat();

    const langChainTools = allTools.map(t => new MimirToolToLangchainTool(t));
    const modelWithTools = model.bindTools!(langChainTools);
    const defaultAttributes: AttributeDescriptor[] = [

    ]

    const workspaceManager = new WorkspanceManager(workspace);

    const pluginContextProvider = new PluginContextProvider(allCreatedPlugins, {});

    const callLLm = () => {
        return async (state: typeof StateAnnotation.State) => {

            const lastMessage: BaseMessage = state.messages[state.messages.length - 1];

            let nextMessage = isHumanMessage(lastMessage) ?
                langChainHumanMessageToMimirHumanMessage(lastMessage) : isToolMessage(lastMessage) ?
                    langChainToolMessageToMimirToolMessage(lastMessage) : undefined;
            if (nextMessage === undefined) {
                throw new Error("No next message found");
            }
            await Promise.all(allCreatedPlugins.map(p => p.readyToProceed(nextMessage!)));



            const pluginAttributes = (await Promise.all(
                allCreatedPlugins.map(async (plugin) => await plugin.attributes(nextMessage!))
            )).flatMap(e => e);
            const fieldMapper = new ResponseFieldMapper([...pluginAttributes, ...defaultAttributes]);
            const responseFormatSystemMessage = [
                {
                    type: "text",
                    text: `${config.constitution ?? DEFAULT_CONSTITUTION}\n`
                } satisfies ComplexMessageContent,
                {
                    text: fieldMapper.createFieldInstructions(),
                    type: "text"
                } satisfies ComplexMessageContent
            ]

            let response: AIMessage;
            let messageToStore: BaseMessage[] = [];
            const messageId = lastMessage.id ?? v4();


            const messageListToSend = [...state.messages].slice(0, -1).map(m => {
                if (m.getType() === "ai" && m.response_metadata["original_content"]) {
                    return new AIMessage({
                        ...m,
                        content: complexResponseToLangchainMessageContent(m.response_metadata["original_content"])
                    })
                }
                return m;
            })

            if (nextMessage.type === "USER_MESSAGE") {
                const inputMessage = humanMessageToInputAgentMessage(lastMessage);
                await workspaceManager.loadFiles(inputMessage.sharedFiles ?? []);
                const { displayMessage, persistentMessage } = await pluginContextProvider.additionalMessageContent(inputMessage);
                displayMessage.content = trimAndSanitizeMessageContent(displayMessage.content);
                persistentMessage.message.content = trimAndSanitizeMessageContent(persistentMessage.message.content);


                messageListToSend.push(new HumanMessage({
                    id: messageId,
                    content: complexResponseToLangchainMessageContent(displayMessage.content)
                }));
                messageToStore = [new HumanMessage({
                    response_metadata: {
                        persistentMessageRetentionPolicy: persistentMessage.retentionPolicy,
                        original_content: persistentMessage.message.content,
                        shared_files: inputMessage.sharedFiles,
                    },
                    id: messageId,
                    content: complexResponseToLangchainMessageContent(inputMessage.content)
                })];

                const pluginInputs = await pluginContextProvider.getSystemPromptContext();
                const systemMessage = buildSystemMessage([...responseFormatSystemMessage, dividerSystemMessage, ...pluginInputs]);
                response = await modelWithTools.invoke([systemMessage, ...messageListToSend]);

            } else  {
                messageListToSend.push(lastMessage);
                if (((lastMessage) as ToolMessage).status !== "error") {
                    const { displayMessage, persistentMessage } = await pluginContextProvider.additionalMessageContent({ content: [] });
                    displayMessage.content = trimAndSanitizeMessageContent(displayMessage.content);
                    persistentMessage.message.content = trimAndSanitizeMessageContent(persistentMessage.message.content);


                    if (displayMessage.content.length > 0) {
                        messageListToSend.push(new HumanMessage({
                            id: v4(),
                            content: complexResponseToLangchainMessageContent([
                                {
                                    type: "text",
                                    text: "Tools invoked succesfully (unless a tool call told you it failed or was cancelled), continue please but be sure the results from the tools are correct and what you expected."
                                },
                                ...displayMessage.content
                            ])
                        }));
                    }
                    if (persistentMessage.message.content.length > 0) {
                        messageToStore = [new HumanMessage({
                            id: `do-not-render-${v4()}`,
                            response_metadata: {
                                persistentMessageRetentionPolicy: persistentMessage.retentionPolicy,
                                original_content: persistentMessage.message.content
                            },
                            content: []
                        })];
                    }
                }

                const pluginInputs = await pluginContextProvider.getSystemPromptContext();
                const systemMessage = buildSystemMessage([...responseFormatSystemMessage, dividerSystemMessage, ...pluginInputs]);
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

            const reformattedAiMessage = new AIMessage({
                ...response,
                content: complexResponseToLangchainMessageContent(fieldMapper.getUserMessage(messageContent).result),
                response_metadata: {
                    original_content: messageContent
                }
            });

            return {
                messages: [...messageToStore, reformattedAiMessage],
                responseAttributes: rawResponseAttributes,
            };
        };
    }


    function routeAfterLLM(
        state: typeof MessagesAnnotation.State,
    ): typeof END | "human_review_node" {
        const lastMessage: AIMessage = state.messages[state.messages.length - 1];

        if (
            (lastMessage as AIMessage).tool_calls?.length === 0
        ) {
            return END;
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
            const messageContent = message.response_metadata["original_content"] as ComplexMessageContent[];

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
                        content: complexResponseToLangchainMessageContent(updatedContent),
                        response_metadata: {
                            ...message.response_metadata,
                            persistentMessageRetentionPolicy: updatedRetention,
                            original_content: updatedContent
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
        const toolRequest = state.messages[state.messages.length - 1] as AIMessage;

       
        const humanInterrupt: HumanInterrupt = {
            description: "The agent is requesting permission to execute the following tool.",
            action_request: {
                action: "Execute_Tools",
                args: (toolRequest.tool_calls ?? [])
            },
            config: {
                allow_accept: true,
                allow_ignore: false,
                allow_respond: true,
                allow_edit: true
            }
        }
        const humanReviewResponse = interrupt<HumanInterrupt, HumanResponse | HumanResponse[]>(humanInterrupt);
        const humanReview: HumanResponse = Array.isArray(humanReviewResponse) ? humanReviewResponse[0] : humanReviewResponse

        const name = modelWithTools.getName();
        if (humanReview.type === "response") {

            //Claude forcefully needs a tool message after a tool call, so we need to send it a tool message with the feedback. Every other model can just receive a human message.
            if (name === "ChatAnthropic" || name === "ChatOpenAI") {
                const responseMessage = new ToolMessage({
                    id: v4(),
                    tool_call_id: toolRequest.tool_calls![0].id!,
                    content: complexResponseToLangchainMessageContent([
                        { type: "text", text: `I have cancelled the execution of the tool calls and instead I am giving you the following feedback:\n` },
                        { type: 'text', text: humanReview.args as string }]),
                })
                return new Command({ goto: "call_llm", update: { messages: [responseMessage] } });
            } else {
                const responseMessage = new HumanMessage({
                    id: v4(),
                    content: complexResponseToLangchainMessageContent([
                        { type: "text", text: `I have cancelled the execution of the tool calls and instead I am giving you the following feedback:\n` },
                        { type: 'text', text: humanReview.args as string }]),
                })
                return new Command({ goto: "call_llm", update: { messages: [responseMessage] } });
            }
        }
        return new Command({ goto: "run_tool" });
    }

    const workflow = new StateGraph(StateAnnotation)
        .addNode("call_llm", callLLm())
        .addNode("run_tool", toolNodeFunction(langChainTools, { handleToolErrors: true }))
        .addNode("message_prep", messageRetentionNode)
        .addNode("human_review_node", humanReviewNode, {
            ends: ["run_tool", "message_prep"]
        })
        .addEdge(START, "message_prep")
        .addConditionalEdges(
            "call_llm",
            routeAfterLLM,
            ["human_review_node", END]
        )
        .addEdge("run_tool", "message_prep")
        .addEdge("message_prep", "call_llm");

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

    const memory = config.checkpointer ?? new MemorySaver()

    const graph = workflow.compile({
        checkpointer: memory,
    });

    return {
        graph: graph,
        workspace: workspace,
        commandList: commandList,
        plugins: allCreatedPlugins
    };
}

export async function createAgent(config: CreateAgentArgs): Promise<Agent> {

    const agent = await createLgAgent(config);

    return new LanggraphAgent({
        name: config.name,
        description: config.description,
        workspace: agent.workspace,
        commands: agent.commandList,
        graph: agent.graph,
        plugins: agent.plugins
    })
}


function buildSystemMessage(agentSystemMessages: ComplexMessageContent[]) {
    const messages = agentSystemMessages.map((m) => {
        return mergeSystemMessages([new SystemMessage({ content: complexResponseToLangchainMessageContent([m]) })])
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
