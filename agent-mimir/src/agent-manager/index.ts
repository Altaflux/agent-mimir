import { StructuredTool, tool, Tool } from "@langchain/core/tools";
import { AdditionalContent, Agent, AgentContext, AgentResponse, AgentSystemMessage, AgentToolRequest, AgentToolRequestResponse, AgentUserMessage, AgentUserMessageResponse, AttributeDescriptor, ComplexResponse, MimirAgentPlugin, MimirPluginFactory, NextMessageUser, PluginContext, ToolResponse, WorkspaceManagerFactory } from "../schema.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Embeddings } from "@langchain/core/embeddings";
import { END, MemorySaver, MessagesAnnotation, START, StateGraph, interrupt, Command, messagesStateReducer, Send } from "@langchain/langgraph";
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, isAIMessage, isHumanMessage, MessageContent, MessageContentComplex, MessageContentImageUrl, MessageContentText, RemoveMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { ToolCall } from "@langchain/core/messages/tool";
import { aiMessageToMimirAiMessage, complexResponseToLangchainMessageContent } from "../utils/format.js";
import { v4 } from "uuid";
import { Annotation } from "@langchain/langgraph";
import { AgentTool } from "../tools/index.js";
import { LangchainToolToMimirTool, MimirToolToLangchainTool } from "../utils/wrapper.js";
import { ResponseFieldMapper } from "../utils/instruction-mapper.js";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { HelpersPluginFactory } from "../plugins/helpers.js";
export type CreateAgentOptions = {
    profession: string,
    description: string,
    name: string,
    model: BaseChatModel,
    plugins?: MimirPluginFactory[],
    constitution?: string,
    visionSupport?: 'openai'
    communicationWhitelist?: boolean | string[],
    tools?: Tool[],
}

export type ManagerConfig = {

    workspaceManagerFactory: WorkspaceManagerFactory,
    embeddings: Embeddings
}

export const StateAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    requestAttributes: Annotation<Record<string, any>>,
    responseAttributes: Annotation<Record<string, any>>,
    output: Annotation<AgentUserMessage>,
    agentMessage: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
});


export class AgentManager {
    private map: Map<string, Agent> = new Map();

    public constructor(private managerConfig: ManagerConfig) { }

    public async createAgent(config: CreateAgentOptions): Promise<Agent> {
        const agent = await this.createAgentNoRegister(config);
        this.map.set(agent.name, agent);
        return agent;
    }

    private async createAgentNoRegister(config: CreateAgentOptions): Promise<Agent> {

        const shortName = config.name;


        const embeddings = this.managerConfig.embeddings;
        const model = config.model;

        const workspace = await this.managerConfig.workspaceManagerFactory(shortName);

        const allPluginFactories = (config.plugins ?? []);
        const canCommunicateWithAgents = config.communicationWhitelist ?? false;
        let communicationWhitelist = undefined;
        if (Array.isArray(canCommunicateWithAgents)) {
            communicationWhitelist = canCommunicateWithAgents
        }

        if (config.communicationWhitelist) {
            const helpersPlugin = new HelpersPluginFactory({
                name: shortName,
                helperSingleton: this,
                communicationWhitelist: communicationWhitelist ?? null
            });

            allPluginFactories.push(helpersPlugin);
        }

        const tools = [
            ...(config.tools ?? []),
        ];
        const toolPlugins: MimirPluginFactory[] = [...tools.map(tool => new LangchainToolWrapperPluginFactory(tool))];

        const allCreatedPlugins = await Promise.all([...allPluginFactories, ...toolPlugins].map(async factory => factory.create({
            workspace: workspace,
            agentName: shortName,
            persistenceDirectory: await workspace.pluginDirectory(factory.name),
        })));


        const allTools = (await Promise.all(allCreatedPlugins.map(async plugin => await plugin.tools()))).flat();
        // if (config.name === "WeatherChecker") {
        //     allTools.push(new WeatherTool())
        // }
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
            const aum: AgentUserMessage = JSON.parse(agenrM.content as string);
            const humanReview = interrupt<
                AgentUserMessage,
                {
                    response: string;
                }>(aum);


            const toolResponse = new ToolMessage({
                id: v4(),
                tool_call_id: agenrM.tool_call_id,
                content: [
                    {
                        type: "text",
                        text: humanReview.response
                    }
                ]

            })
            return { messages: [toolResponse], agentMessage: [new RemoveMessage({ id: agenrM.id! })] };

        }


        const callLLM = async (state: typeof StateAnnotation.State) => {

            const lastMessage: BaseMessage = state.messages[state.messages.length - 1];

            if (isAIMessage(lastMessage)) {
                return {}
            }

            await Promise.all(allCreatedPlugins.map(p => p.readyToProceed(state)));

            const pluginInputs = (await Promise.all(
                allCreatedPlugins.map(async (plugin) => await plugin.getSystemMessages(state))
            ))

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


            const systemMessage = buildSystemMessage([...pluginInputs, responseFormatSystemMessage]);


            let response: AIMessageChunk;
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
                response = await modelWithTools.invoke([systemMessage, ...messageListToSend]);

            } else {
                messageToStore = lastMessage;
                response = await modelWithTools.invoke([systemMessage, ...state.messages]);
            }

            let mimirAiMessage = aiMessageToMimirAiMessage(response);
            const rawResponseAttributes = await fieldMapper.readInstructionsFromResponse(mimirAiMessage.content);

            const responseAttributes = (await Promise.all(
                allCreatedPlugins.map(async (plugin) => await plugin.readResponse(mimirAiMessage, state, rawResponseAttributes))
            )).reduce((acc, d) => ({ ...acc, ...d }), {
                messageToSend: rawResponseAttributes["userMessage"]
            });

            return { messages: [messageToStore, response], requestAttributes: {}, responseAttributes: responseAttributes };
        };

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
            const toolRequest = parseToolMessage(lastMessage, {});
            const humanReview = interrupt<
                AgentToolRequest,
                {
                    action: string;
                    data: any;
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
                    content: `The user has cancelled the execution of this function as instead has given you the following feedback: "${reviewData}"`,
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
                let responseMessage = parseUserMessage(aiMessage, responseAttributes);

                return { output: responseMessage }
            }
            return {}
        }

        const workflow = new StateGraph(StateAnnotation)
            .addNode("call_llm", callLLM)
            .addNode("run_tool", new ToolNode(langChainTools))
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
        const memory = new MemorySaver();

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
            const messagesToRemove = messages.map((m) => new RemoveMessage({ id: m.id! }))
            await graph.updateState(stateConfig, { messages: messagesToRemove }, "output_convert")
        };


        return {
            name: shortName,
            description: config.description,
            workspace: workspace,
            reset: reset,
            call: async (continuousMode, message, input, callback) => {


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
                            content: [
                                {
                                    type: "text",
                                    text: message,
                                }
                            ]
                        })],
                        requestAttributes: input,
                        responseAttributes: {}
                    } : null;
                }


                while (true) {
                    let stream = await graph.stream(graphInput, stateConfig);
                    for await (const event of stream) {

                    }

                    const state = await graph.getState(stateConfig);
                    const responseAttributes: Record<string, any> = state.values["responseAttributes"];
                    if (state.tasks.length > 0 && state.tasks[0].name === "human_review_node") {
                        if (continuousMode) {
                            graphInput = new Command({ resume: { action: "continue" } })
                            continue
                        } else {
                            const interruptState = state.tasks[0].interrupts[0];
                            return {
                                type: "toolRequest",
                                output: interruptState.value as AgentToolRequest,
                                responseAttributes: responseAttributes
                            } as any
                        }

                    }

                    if (state.tasks.length > 0 && state.tasks[0].name === "agent_call") {
                        const interruptState = state.tasks[0].interrupts[0];
                        return {
                            type: "agentResponse",
                            output: interruptState.value,
                            responseAttributes: {}
                        } as AgentUserMessageResponse
                        
                    }
                    let userResponse = (state.values["output"] as AgentUserMessage);
                    return {
                        type: "agentResponse",
                        output: userResponse,
                        responseAttributes: responseAttributes
                    } as AgentUserMessageResponse
                }
            }
        }
    }

    public getAgent(shortName: string): Agent | undefined {
        const agent = this.map.get(shortName);
        return agent
    }

    public getAllAgents(): Agent[] {
        return Array.from(this.map.values())
    }
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
function parseUserMessage(aiMessage: AIMessage, responseAttributes: Record<string, any>): AgentUserMessage {
    let content = aiMessage.content;
    let textContent: string;
    if (responseAttributes["messageToSend"]) {
        textContent = responseAttributes["messageToSend"] as string;
    } else {
        if (typeof content === 'string' || content instanceof String) {
            textContent = content as string;
        } else {
            textContent = (content as MessageContentComplex[]).filter(e => e.type === "text")
                .map(e => (e as MessageContentText).text)
                .join("\n");
        }
    }

    let resp: AgentUserMessage = {
        message: textContent
    }

    return resp;
}
function parseToolMessage(aiMessage: AIMessage, responseAttributes: Record<string, any>): AgentToolRequest {
    let content = aiMessage.content;
    let textContent: string;
    if (responseAttributes["messageToSend"]) {
        textContent = responseAttributes["messageToSend"] as string;
    } else {
        if (typeof content === 'string' || content instanceof String) {
            textContent = content as string;
        } else {
            textContent = (content as MessageContentComplex[]).filter(e => e.type === "text")
                .map(e => (e as MessageContentText).text)
                .join("\n");
        }
    }

    let resp: AgentToolRequest = {
        toolRequests: (aiMessage.tool_calls ?? []).map(t => {
            return {
                toolName: t.name,
                toolArguments: JSON.stringify(t.args)
            }
        }),
        message: textContent
    }

    return resp;
}


function langChainHumanMessageToMimirHumanMessage(message: HumanMessage): NextMessageUser {
    return {
        type: "USER_MESSAGE",
        content: lCmessageContentToContent(message.content)
    }
}


function lCmessageContentToContent(content: MessageContent): ComplexResponse[] {
    const response: ComplexResponse[] = [];
    if (typeof content === 'string' || content instanceof String) {
        return [{
            type: "text",
            text: content as string
        }]
    } else {
        return (content as MessageContentComplex[])
            .map(c => {
                if (c.type! == "text") {
                    return {
                        type: "text",
                        text: (c as MessageContentText).text as string
                    }
                } else if (c.type! == "image_url") {
                    let image_url;
                    const img_content = (c as MessageContentImageUrl);
                    if (typeof img_content.image_url === 'string' || img_content.image_url instanceof String) {
                        image_url = img_content.image_url as string;
                    } else {
                        image_url = img_content.image_url.url;
                    }
                    return {
                        type: "text",
                        text: image_url
                    }
                } else {
                    throw new Error(`Unsupported content type: ${c.type}`)
                }
            })
    }

}


function mergeSystemMessages(messages: SystemMessage[]) {
    return messages.reduce((prev, next) => {
        const prevContent = (prev.content instanceof String) ? [{
            type: "text",
            text: prev.content
        }] as MessageContentText[] : prev.content as MessageContentComplex[];
        const nextContent = (next.content instanceof String) ? [{
            type: "text",
            text: next.content
        }] as MessageContentText[] : next.content as MessageContentComplex[];

        return new SystemMessage({ content: [...prevContent, ...nextContent] });
    }, new SystemMessage({ content: [] }))

}
const dividerSystemMessage = new SystemMessage({
    content: [
        {
            type: "text",
            text: "\n\n--------------------------------------------------\n\n"
        }
    ]
});
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



export class WeatherPlugin extends MimirAgentPlugin {

    async additionalMessageContent(message: NextMessageUser, context: AgentContext): Promise<AdditionalContent[]> {
        return [
            {
                displayOnCurrentMessage: false,
                saveToChatHistory: true,
                content: [

                    {
                        type: "text",
                        text: "+++"
                    }
                ]
            },
            {
                displayOnCurrentMessage: true,
                saveToChatHistory: false,
                content: [

                    {
                        type: "text",
                        text: "---"
                    }
                ]
            }
        ];
    }
    tools(): Promise<(AgentTool)[]> | (AgentTool)[] {
        const getWeather = tool((input) => {
            const city = input.city;
            console.log("----");
            console.log(`Searching for: ${city}`);
            console.log("----");
            let response: MessageContentComplex[] = [
                {
                    type: "text",
                    text: "Sunny!"
                }
            ];
            return response;
        }, {
            name: "get_weather",
            description: "Call to get the current weather.",
            schema: z.object({
                city: z.string().describe("City to get the weather for."),
            }),
        });

        return [new WeatherTool()]
    }

}

class WeatherTool extends AgentTool {
    schema = z.object({
        city: z.string().describe("City to get the weather for."),
    });
    protected async _call(input: any, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        console.log("----");
        console.log(`Searching for: ${input.city}`);
        console.log("----");
        return [
            {
                type: "text",
                text: "It is rainy today!"
            }
        ]
    }
    name: string = "get_weather";
    description: string = "Call to get the current weather.";

}


class LangchainToolWrapperPluginFactory implements MimirPluginFactory {

    name: string;

    constructor(private tool: StructuredTool) {
        this.name = tool.name;
    }
    create(context: PluginContext): MimirAgentPlugin {
        return new LangchainToolWrapper(this.tool);
    }
}

class LangchainToolWrapper extends MimirAgentPlugin {

    constructor(private tool: StructuredTool) {
        super();
    }

    tools(): AgentTool[] {
        return [new LangchainToolToMimirTool(this.tool)];
    }
}