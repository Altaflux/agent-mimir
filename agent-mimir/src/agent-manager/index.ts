import {  tool, Tool } from "@langchain/core/tools";
import { AdditionalContent, Agent, AgentContext, AgentResponse, AgentSystemMessage, AgentToolRequest, AgentToolRequestResponse, AgentUserMessage, AgentUserMessageResponse, ComplexResponse, MimirAgentPlugin, MimirPluginFactory, NextMessageUser, WorkspaceManagerFactory } from "../schema.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Embeddings } from "@langchain/core/embeddings";
import { END, MemorySaver, MessagesAnnotation, START, StateGraph, interrupt, Command } from "@langchain/langgraph";
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, isHumanMessage, MessageContent, MessageContentComplex, MessageContentImageUrl, MessageContentText, RemoveMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { ToolCall } from "@langchain/core/messages/tool";
import { aiMessageToMimirAiMessage, complexResponseToLangchainMessageContent } from "../utils/format.js";
import { v4 } from "uuid";
import { Annotation } from "@langchain/langgraph";
import { AgentTool } from "../tools/index.js";
import { LangchainToolToMimirTool, MimirToolToLangchainTool } from "../utils/wrapper.js";
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
        const allCreatedPlugins = await Promise.all(allPluginFactories.map(async factory => factory.create({
            workspace: workspace,
            agentName: shortName,
            persistenceDirectory: await workspace.pluginDirectory(factory.name),
        })));
   //     const allCreatedPlugins: MimirAgentPlugin[] = [new WeatherPlugin()];


        const allTools = (await Promise.all(allCreatedPlugins.map(async plugin => await plugin.tools()))).flat();
        const langChainTools = allTools.map(t => new MimirToolToLangchainTool(t));
        //const allTools = [getWeather];



        const modelWithTools = model.bindTools!(langChainTools);


        const callLLM = async (state: typeof StateAnnotation.State) => {

            const lastMessage: BaseMessage = state.messages[state.messages.length - 1];
            await Promise.all(allCreatedPlugins.map(p => p.readyToProceed(state)));

            const pluginInputs = (await Promise.all(
                allCreatedPlugins.map(async (plugin) => await plugin.getSystemMessages(state))
            ))

            const systemMessage = buildSystemMessage(pluginInputs);

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
            for (const plugin of allCreatedPlugins) {
                plugin.readResponse(mimirAiMessage, state);
            }
            return { messages: [messageToStore, response], requestAttributes: {} };
        };

        function routeAfterLLM(
            state: typeof MessagesAnnotation.State,
        ): "dummy_end" | "human_review_node" {
            const lastMessage: AIMessage = state.messages[state.messages.length - 1];

            if (
                (lastMessage as AIMessage).tool_calls?.length === 0
            ) {
                return "dummy_end";
            } else {
                return "human_review_node";
            }
        }

        function humanReviewNode(state: typeof MessagesAnnotation.State) {
            const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
            const toolCall = lastMessage.tool_calls![lastMessage.tool_calls!.length - 1];

            const humanReview = interrupt<
                {
                    question: string;
                    toolCall: ToolCall;
                },
                {
                    action: string;
                    data: any;
                }>({
                    question: "Is this correct?",
                    toolCall: toolCall
                });


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



        const workflow = new StateGraph(StateAnnotation)
            .addNode("call_llm", callLLM)
            .addNode("run_tool", new ToolNode(langChainTools))
            .addNode("human_review_node", humanReviewNode, {
                ends: ["run_tool", "call_llm"]
            })
            .addNode("dummy_end", async () => { return {} })
            .addEdge(START, "call_llm")
            .addConditionalEdges(
                "call_llm",
                routeAfterLLM,
                ["human_review_node", "dummy_end"]
            )
            .addEdge("run_tool", "call_llm")
            .addEdge("dummy_end", END);

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
            await graph.updateState(stateConfig, { messages: messagesToRemove }, "dummy_end")
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
                } else {

                    graphInput = message != null ? {
                        messages: [new HumanMessage({
                            id: `${v4()}`,
                            content: [
                                {
                                    type: "text",
                                    text: message,
                                }
                            ]
                        })], requestAttributes: input
                    } : null;
                }


                while (true) {
                    let stream = await graph.stream(graphInput, stateConfig);
                    for await (const event of stream) {
                        const recentMsg = event.messages[event.messages.length - 1];
                    }

                    const state = await graph.getState(stateConfig);
                    const aiMessage: AIMessage = state.values["messages"][state.values["messages"].length - 1];
                    let responseMessage = parseMessage(aiMessage);
                    if (continuousMode && state.next.length > 0 && state.next[0] === "human_review_node") {
                        graphInput = new Command({ resume: { action: "continue" } })
                        continue;
                    }

                    return responseMessage as any;
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

function parseMessage(aiMessage: AIMessage): AgentResponse {
    let content = aiMessage.content;
    let textContent: string;
    if (typeof content === 'string' || content instanceof String) {
        textContent = content as string;
    } else {
        textContent = (content as MessageContentComplex[]).filter(e => e.type === "text")
            .map(e => (e as MessageContentText).text)
            .join("\n");
    }


    if ((aiMessage.tool_calls?.length ?? 0) > 0) {
        let resp: AgentToolRequest = {
            toolRequests: (aiMessage.tool_calls ?? []).map(t => {
                return {
                    toolName: t.name,
                    toolArguments: JSON.stringify(t.args)
                }
            }),
            message: textContent
        }

        return new AgentToolRequestResponse(resp);
    } else {
        let resp: AgentUserMessage = {
            message: textContent
        }

        return new AgentUserMessageResponse(resp);;
    }
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

        return [new LangchainToolToMimirTool(getWeather)]
    }

}