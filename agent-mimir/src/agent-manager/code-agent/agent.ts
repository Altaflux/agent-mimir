import { ComplexMessageContent, } from "../../schema.js";
import { WorkspacePluginFactory, WorkspanceManager } from "../../plugins/workspace.js";
import { ViewPluginFactory } from "../../tools/image_view.js";
import { complexResponseToLangchainMessageContent, extractTextContent, trimAndSanitizeMessageContent } from "../../utils/format.js";
import { AIMessage, BaseMessage, HumanMessage, MessageContentComplex, MessageContentText, RemoveMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, BaseCheckpointSaver, Command, END, interrupt, MemorySaver, Messages, MessagesAnnotation, START, StateDefinition, StateGraph } from "@langchain/langgraph";
import { v4 } from "uuid";
import { ResponseFieldMapper } from "../../utils/instruction-mapper.js";
import { dividerSystemMessage, humanMessageToInputAgentMessage, lCmessageContentToContent, mergeSystemMessages } from "./../message-utils.js";
import { Agent, AgentMessageToolRequest, AgentWorkspace, InputAgentMessage, WorkspaceFactory } from "./../index.js";
import { PluginFactory } from "../../plugins/index.js";
import { aiMessageToMimirAiMessage, getExecutionCodeContentRegex, isToolMessage, langChainToolMessageToMimirHumanMessage, toolMessageToToolResponseInfo, toPythonFunctionName } from "./utils.js";
import { pythonToolNodeFunction } from "./tool-node.js";
import { FUNCTION_PROMPT, getFunctionsPrompt, PYTHON_SCRIPT_SCHEMA } from "./prompt.js";
import { DefaultPluginFactory } from "../../plugins/default-plugins.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { CodeToolExecutor } from "./index.js";
import { DEFAULT_CONSTITUTION } from "../constants.js";
import { PluginContextProvider } from "../../plugins/context-provider.js";
import { langChainHumanMessageToMimirHumanMessage } from "../tool-agent/utils.js";
import { LanggraphAgent } from "../langgraph-agent.js";

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

    codeExecutor: (workspace: AgentWorkspace) => CodeToolExecutor,

    checkpointer?: BaseCheckpointSaver
}



export const StateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    requestAttributes: Annotation<Record<string, any>>,
    responseAttributes: Annotation<Record<string, any>>,
    output: Annotation<AgentMessageToolRequest>,
    noMessagesInTool: Annotation<Boolean>,
});



export async function createLgAgent(config: CreateAgentArgs) {

    const shortName = config.name;
    const model = config.model;
    const workspace = await config.workspaceFactory(shortName);
    const allPluginFactories = (config.plugins ?? []);

    const toolPlugins: PluginFactory[] = [];
    toolPlugins.push(new WorkspacePluginFactory());
    toolPlugins.push(new ViewPluginFactory());
    toolPlugins.push(new DefaultPluginFactory());
    const allCreatedPlugins = await Promise.all([...allPluginFactories, ...toolPlugins].map(async factory => await factory.create({
        workspace: workspace,
    })));


    const allTools = (await Promise.all(allCreatedPlugins.map(async plugin => await plugin.tools()))).flat();

    const modelWithTools = model;
    const codeExecutor = config.codeExecutor(workspace);
    const workspaceManager = new WorkspanceManager(workspace)

    const pluginContextProvider = new PluginContextProvider(allCreatedPlugins, {
        toolNameSanitizer: toPythonFunctionName
    });

    const callLLm = () => {
        return async (state: typeof StateAnnotation.State) => {

            const lastMessage: BaseMessage = state.messages[state.messages.length - 1];

            let nextMessage = isToolMessage(lastMessage)
                ? langChainToolMessageToMimirHumanMessage(lastMessage)
                : langChainHumanMessageToMimirHumanMessage(lastMessage);

            if (nextMessage === undefined) {
                throw new Error("No next message found");
            }
            await Promise.all(allCreatedPlugins.map(p => p.readyToProceed(nextMessage!)));

            const pluginAttributes = (await Promise.all(
                allCreatedPlugins.map(async (plugin) => await plugin.attributes(nextMessage!))
            )).flatMap(e => e);
            const fieldMapper = new ResponseFieldMapper([...pluginAttributes]);
            const responseFormatSystemMessage = [
                {
                    type: "text" as const,
                    text: `${config.constitution ?? DEFAULT_CONSTITUTION}\n`
                } satisfies ComplexMessageContent,
                {
                    type: "text" as const,
                    text: FUNCTION_PROMPT + "\n" + getFunctionsPrompt(codeExecutor.availableDependencies, allTools)
                } satisfies ComplexMessageContent,
                {
                    text: fieldMapper.createFieldInstructions(PYTHON_SCRIPT_SCHEMA),
                    type: "text" as const
                } satisfies ComplexMessageContent
            ]
            let response: AIMessage;
            let messageToStore: BaseMessage[] = [];
            const messageId = lastMessage.id ?? v4();
            if (nextMessage.type === "USER_MESSAGE") {
                const inputMessage = humanMessageToInputAgentMessage(lastMessage);
                await workspaceManager.loadFiles(inputMessage.sharedFiles ?? []);
                const { displayMessage, persistentMessage } = await pluginContextProvider.additionalMessageContent(inputMessage);
                displayMessage.content = trimAndSanitizeMessageContent(displayMessage.content);
                persistentMessage.message.content = trimAndSanitizeMessageContent(persistentMessage.message.content);

                const messageListToSend = [...state.messages];
                messageListToSend.push(new HumanMessage({
                    id: messageId,
                    content: complexResponseToLangchainMessageContent(displayMessage.content)
                }));
                messageToStore = [new HumanMessage({
                    response_metadata: {
                        persistentMessageRetentionPolicy: persistentMessage.retentionPolicy
                    },
                    id: messageId,
                    content: complexResponseToLangchainMessageContent(persistentMessage.message.content)
                })];


                const pluginInputs = await pluginContextProvider.getSystemPromptContext();
                const systemMessage = buildSystemMessage([...responseFormatSystemMessage, dividerSystemMessage, ...pluginInputs]);
                response = await modelWithTools.invoke([systemMessage, ...messageListToSend]);

            } else {
                const messageListToSend = [...state.messages];
                if (isToolMessage(lastMessage)) {
                    const { displayMessage, persistentMessage } = await pluginContextProvider.additionalMessageContent({ content: [] });
                    displayMessage.content = trimAndSanitizeMessageContent(displayMessage.content);
                    persistentMessage.message.content = trimAndSanitizeMessageContent(persistentMessage.message.content);
                    if (displayMessage.content.length > 0) {
                        messageListToSend.push(new HumanMessage({
                            id: messageId,
                            content: complexResponseToLangchainMessageContent(displayMessage.content)
                        }));
                    }
                    if (persistentMessage.message.content.length > 0) {
                        messageToStore = [new HumanMessage({
                            id: messageId,
                            response_metadata: {
                                persistentMessageRetentionPolicy: persistentMessage.retentionPolicy
                            },
                            content: complexResponseToLangchainMessageContent(persistentMessage.message.content)
                        })];
                    }
                }

                const pluginInputs = await pluginContextProvider.getSystemPromptContext();
                const systemMessage = buildSystemMessage([...responseFormatSystemMessage, dividerSystemMessage, ...pluginInputs]);

                response = await modelWithTools.invoke([systemMessage, ...messageListToSend]);
            }

            // Claude sometimes likes to respond with empty messages when there is no more content to send
            if (response.content.length === 0) {
                response = new AIMessage({
                    id: response.id,
                    content: [{
                        type: "text",
                        text: "I have completed my task.",
                    }]
                })
            }
            //Agents calling agents cannot see the messages from the tool, so we remove them so the AI doesn't think it has already responded.
            if (getExecutionCodeContentRegex(extractTextContent(response.content)) !== null && state.noMessagesInTool) {
                const codeScript = getExecutionCodeContentRegex(extractTextContent(response.content));
                response = new AIMessage({
                    id: response.id,
                    content: [{
                        type: "text",
                        text: `<execution-code>\n${codeScript}\n</execution-code>`
                    }]
                })
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
                responseAttributes: rawResponseAttributes
            };
        };
    }


    function routeAfterLLM(
        state: typeof MessagesAnnotation.State,
    ): "output_convert" | "human_review_node" {
        const lastMessage: AIMessage = state.messages[state.messages.length - 1];
        let messageText = "";
        if (typeof lastMessage.content === "string") {
            messageText = lastMessage.content;
        } else {
            messageText = extractTextContent(lastMessage.content);
        }

        if (getExecutionCodeContentRegex(messageText) === null) {
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
        const toolRequest: AgentMessageToolRequest = state.output;
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
            await workspaceManager.loadFiles(reviewData.sharedFiles ?? []);
            const responseMessage = new HumanMessage({
                response_metadata: {
                    toolMessage: true
                },
                id: v4(),
                content: complexResponseToLangchainMessageContent([
                    { type: "text", text: `I have cancelled the execution of the tool calls and instead I am giving you the following feedback:\n` },
                    ...reviewData.content]),
            });
            return new Command({ goto: "call_llm", update: { messages: [responseMessage] } });
        }
        throw new Error("Unreachable");
    }

    function outputConvert(state: typeof StateAnnotation.State) {

        return {}
    }

    const workflow = new StateGraph(StateAnnotation)
        .addNode("call_llm", callLLm())
        .addNode("run_tool", pythonToolNodeFunction(allTools, codeExecutor, { handleToolErrors: true }))
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
        plugins: agent.plugins,
        toolMessageHandler: {
            isToolMessage: isToolMessage,
            messageToToolMessage: toolMessageToToolResponseInfo,
        }
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

