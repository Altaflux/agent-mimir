import { ComplexMessageContent, } from "../../schema.js";
import { WorkspacePluginFactory, WorkspanceManager } from "../../plugins/workspace.js";
import { ViewPluginFactory } from "../../tools/image_view.js";
import { MimirToolToLangchainTool } from "./wrapper.js";
import { ToolMessage } from "@langchain/core/messages/tool";
import { complexResponseToLangchainMessageContent, trimAndSanitizeMessageContent } from "../../utils/format.js";
import { AIMessage, BaseMessage, ContentBlock, HumanMessage,   RemoveMessage, SystemMessage } from "@langchain/core/messages";
import {  BaseCheckpointSaver, Command, END, interrupt, MemorySaver,  START,  StateGraph, GraphNode, ConditionalEdgeRouter } from "@langchain/langgraph";
import { v4 } from "uuid";
import { ResponseFieldMapper } from "../../utils/instruction-mapper.js";
import { dividerSystemMessage, humanMessageToInputAgentMessage, lCmessageContentToContent, mergeSystemMessages } from "../message-utils.js";
import { Agent, WorkspaceFactory } from "../index.js";
import { AttributeDescriptor, PluginFactory } from "../../plugins/index.js";
import { toolNodeFunction } from "./tool-node.js"
import { aiMessageToMimirAiMessage, langChainHumanMessageToMimirHumanMessage, langChainToolMessageToMimirToolMessage } from "./utils.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { DEFAULT_CONSTITUTION } from "../constants.js";
import { PluginContextProvider, RetentionAwareMessageContent } from "../../plugins/context-provider.js";
import { AgentGraphType, AgentState, LanggraphAgent } from "../langgraph-agent.js";
import { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt";



// const AgentState = new StateSchema({
//     responseAttributes: z.record(z.string(), z.any()),
//     noMessagesInTool: z.boolean(),
//     messages: MessagesValue
// });

// export const StateAnnotation = Annotation.Root({
//     ...MessagesAnnotation.spec,
//     responseAttributes: Annotation<Record<string, any>>,
//     noMessagesInTool: Annotation<Boolean>
// });

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

        const callLLMNode: GraphNode<typeof AgentState> = async (state) => {
            const lastMessage: BaseMessage = state.messages[state.messages.length - 1];

            let nextMessage = HumanMessage.isInstance(lastMessage) ?
                langChainHumanMessageToMimirHumanMessage(lastMessage) : ToolMessage.isInstance(lastMessage) ?
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

                if (m.type === "ai" && m.additional_kwargs["original_content"]) {
                    return new AIMessage({
                        ...m,
                        contentBlocks: complexResponseToLangchainMessageContent(m.additional_kwargs["original_content"] as ComplexMessageContent[])
                    })
                }
                return m;
            })

            if (nextMessage.type === "USER_MESSAGE") {
                const inputMessage = humanMessageToInputAgentMessage(lastMessage as HumanMessage);
                await workspaceManager.loadFiles(inputMessage.sharedFiles ?? []);
                const { displayMessage, persistentMessage } = await pluginContextProvider.additionalMessageContent(inputMessage);
                displayMessage.content = trimAndSanitizeMessageContent(displayMessage.content);
                persistentMessage.message.content = trimAndSanitizeMessageContent(persistentMessage.message.content);


                messageListToSend.push(new HumanMessage({
                    id: messageId,
                    content: complexResponseToLangchainMessageContent(displayMessage.content)
                }));
                messageToStore = [new HumanMessage({
                    additional_kwargs: {
                        persistentMessageRetentionPolicy: persistentMessage.retentionPolicy,
                        original_content: persistentMessage.message.content,
                        shared_files: inputMessage.sharedFiles,
                    },
                    id: messageId,
                    contentBlocks: complexResponseToLangchainMessageContent(inputMessage.content)
                })];

                const pluginInputs = await pluginContextProvider.getSystemPromptContext();
                const systemMessage = buildSystemMessage([...responseFormatSystemMessage, dividerSystemMessage, ...pluginInputs]);
                response = await modelWithTools.invoke([systemMessage, ...messageListToSend]);

            } else {
                messageListToSend.push(lastMessage);
                if (((lastMessage) as ToolMessage).status !== "error") {
                    const { displayMessage, persistentMessage } = await pluginContextProvider.additionalMessageContent({ content: [] });
                    displayMessage.content = trimAndSanitizeMessageContent(displayMessage.content);
                    persistentMessage.message.content = trimAndSanitizeMessageContent(persistentMessage.message.content);


                    if (displayMessage.content.length > 0) {
                        messageListToSend.push(new HumanMessage({
                            id: v4(),
                            contentBlocks: complexResponseToLangchainMessageContent([
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
                            additional_kwargs: {
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
            const messageContent = lCmessageContentToContent(response.contentBlocks);
            const rawResponseAttributes = await fieldMapper.readInstructionsFromResponse(messageContent);
            const sharedFiles = await workspaceManager.readAttributes(rawResponseAttributes);
            let mimirAiMessage = aiMessageToMimirAiMessage(response, sharedFiles, fieldMapper);

            for (const plugin of allCreatedPlugins) {
                await plugin.readResponse(mimirAiMessage, rawResponseAttributes);
            }

            const reformattedAiMessage = new AIMessage({
                ...response,
                content: complexResponseToLangchainMessageContent(fieldMapper.getUserMessage(messageContent).result),
                additional_kwargs: {
                    original_content: messageContent
                }
            });

            return {
                messages: [...messageToStore, reformattedAiMessage],
                responseAttributes: rawResponseAttributes,
            };
        };

        return callLLMNode;
    }

    const routeAfterLLM3: ConditionalEdgeRouter<typeof AgentState> = (state) => {
        const lastMessage = state.messages[state.messages.length - 1];

        if (
            ((lastMessage as AIMessage)?.tool_calls?.length ?? 0) === 0
        ) {
            return END;
        } else {
            return "human_review_node";
        }
    }

    const messageRetentionNode: GraphNode<typeof AgentState> = async (state) => {
        const modifiedMessages: BaseMessage[] = [];

        // Get messages with a persistent retention policy and reverse the order
        const messagesWithRetention = state.messages
            .filter(m => m.additional_kwargs?.persistentMessageRetentionPolicy)
            .reverse();

        // Iterate over messages with retention policies
        for (const [idx, message] of messagesWithRetention.entries()) {
            const retentionPolicy: RetentionAwareMessageContent["persistentMessage"]["retentionPolicy"] = message.additional_kwargs!.persistentMessageRetentionPolicy as any;
            const messageContent = message.additional_kwargs["original_content"] as ComplexMessageContent[];

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
                        contentBlocks: complexResponseToLangchainMessageContent(updatedContent),
                        additional_kwargs: {
                            ...message.additional_kwargs,
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
    const humanReviewNode: GraphNode<typeof AgentState> = async (state) => {
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
                    contentBlocks: complexResponseToLangchainMessageContent([
                        { type: "text", text: `I have cancelled the execution of the tool calls and instead I am giving you the following feedback:\n` },
                        { type: 'text', text: humanReview.args as string }]),
                })
                return new Command({ goto: "call_llm", update: { messages: [responseMessage] } });
            } else {
                const responseMessage = new HumanMessage({
                    id: v4(),
                    contentBlocks: complexResponseToLangchainMessageContent([
                        { type: "text", text: `I have cancelled the execution of the tool calls and instead I am giving you the following feedback:\n` },
                        { type: 'text', text: humanReview.args as string }]),
                })
                return new Command({ goto: "call_llm", update: { messages: [responseMessage] } });
            }
        }
        return new Command({ goto: "run_tool" });
    }

    const workflow = new StateGraph(AgentState)
        .addNode("call_llm", callLLm())
        .addNode("run_tool", toolNodeFunction(langChainTools, { handleToolErrors: true }))
        .addNode("message_prep", messageRetentionNode)
        .addNode("human_review_node", humanReviewNode, {
            ends: ["run_tool", "message_prep"]
        })
        .addEdge(START, "message_prep")
        .addConditionalEdges(
            "call_llm",
            routeAfterLLM3,
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
    const graph: AgentGraphType  = workflow.compile({
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
        return mergeSystemMessages([new SystemMessage({ contentBlocks: complexResponseToLangchainMessageContent([m]) })])
    });

    const finalMessage = mergeSystemMessages(messages);
    const content = finalMessage.contentBlocks as ContentBlock.Standard[];
    const containsOnlyText = content.find((f) => f.type !== "text") === undefined;
    if (containsOnlyText) {
        const systemMessageText = content.reduce((prev, next) => {
            return prev + (next as ContentBlock.Text).text
        }, "");

        return new SystemMessage(systemMessageText);
    }
    return finalMessage;
}
