import { StructuredTool, Tool } from "@langchain/core/tools";
import { TalkToUserTool } from '../tools/core.js';
import { SteppedAgentExecutor } from '../executor/index.js';
import { ChatMemoryChain } from '../memory/transactional-memory-chain.js';

import { Agent, AgentResponse, AgentToolRequest, AgentUserMessage, MimirAgentPlugin, MimirPluginFactory, ToolResponse, PluginContext, WorkspaceManagerFactory } from '../schema.js';

import { initializeAgent } from '../agent/index.js'
import { DEFAULT_CONSTITUTION } from '../agent/prompt.js';
import { TimePluginFactory } from '../plugins/time.js';
import { HelpersPluginFactory } from '../plugins/helpers.js';
import { MimirAgentTypes } from '../agent/index.js';
import { ManualTagMemoryPluginFactory } from '../plugins/tag-memory/plugins.js';
import { CompactingConversationSummaryMemory } from '../memory/compacting-memory/index.js';
import { NoopMemory } from '../memory/noopMemory.js';
import { WorkspacePluginFactory } from "../plugins/workspace.js";
import { ViewPluginFactory } from "../tools/image_view.js";
import { AgentTool } from "../tools/index.js";
import { MimirToolToLangchainTool, LangchainToolToMimirTool } from "../utils/wrapper.js";
import { noopImageHandler, openAIImageHandler } from "../vision/index.js";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type CreateAgentOptions = {
    profession: string,
    description: string,
    agentType?: MimirAgentTypes,
    name: string,
    model: BaseChatModel,
    plugins?: MimirPluginFactory[],
    constitution?: string,
    visionSupport?: 'openai'
    communicationWhitelist?: boolean | string[],
    chatHistory?: {
        summaryModel?: BaseChatModel,
        tokenLimit?: number;
        conversationTokenThreshold?: number;
    }
    tools?: Tool[],
    messageHistory: BaseChatMessageHistory,

}

export type ManagerConfig = {

    workspaceManagerFactory: WorkspaceManagerFactory,
    embeddings: Embeddings
}
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

        const summarizingModel = config.chatHistory?.summaryModel ?? model;
        if (!config.chatHistory?.summaryModel) {
            console.warn(`No summarizing model provided for agent ${shortName}, using the chat model as summarizing model.`);
        }

        const tagPlugin = new ManualTagMemoryPluginFactory(embeddings, summarizingModel ?? config.model);

        const taskCompleteCommandName = "taskComplete";

        const agentCommunicationPlugin: MimirPluginFactory[] = [];
        const canCommunicateWithAgents = config.communicationWhitelist ?? false;
        let communicationWhitelist = undefined;
        if (Array.isArray(canCommunicateWithAgents)) {
            communicationWhitelist = canCommunicateWithAgents
        }

        if (config.communicationWhitelist) {
            const helpersPlugin = new HelpersPluginFactory({
                name: shortName,
                helperSingleton: this,
                model: model,
                communicationWhitelist: communicationWhitelist ?? null
            });

            agentCommunicationPlugin.push(helpersPlugin);
        }


        const tools = [
            ...(config.tools ?? []),
        ];


        const memory = new NoopMemory({
            returnMessages: true,
            memoryKey: "chat_history",
            inputKey: "input",
            outputKey: "output",
        });


        const workspace = await this.managerConfig.workspaceManagerFactory(shortName);

        const timePlugin = new TimePluginFactory();
        const workspacePlugin = new WorkspacePluginFactory();

        const visionSupport = [];
        let imageHandler = noopImageHandler;
        if (config.visionSupport === 'openai') {
            const workspaceImageView = new ViewPluginFactory();
            visionSupport.push(workspaceImageView);
            imageHandler = openAIImageHandler;
        }

        const defaultPluginsFactories = [timePlugin, tagPlugin, ...agentCommunicationPlugin, workspacePlugin, ...visionSupport, ...config.plugins ?? []];

        const allPluginFactories: MimirPluginFactory[] = [...tools.map(tool => new LangchainToolWrapperPluginFactory(tool)), ...defaultPluginsFactories];
        const allCreatedPlugins = await Promise.all(allPluginFactories.map(async factory => factory.create({
            workspace: workspace,
            agentName: shortName,
            persistenceDirectory: await workspace.pluginDirectory(factory.name),
        })));
        const talkToUserTool = new TalkToUserTool(workspace);
        
        const reset = async () => {
            await Promise.all(allCreatedPlugins.map(async plugin => await plugin.clear()));
            await workspace.reset();
            await config.messageHistory.clear()
        };

        const agent = await initializeAgent(config.agentType ?? "plain-text-agent", {
            llm: model,
            name: shortName,
            description: config.description,
            taskCompleteCommandName: taskCompleteCommandName,
            talkToUserTool: talkToUserTool,
            plugins: allCreatedPlugins,
            constitution: config.constitution ?? DEFAULT_CONSTITUTION,
            chatMemory: config.messageHistory,
            imageHandler: imageHandler,
            resetFunction: reset,
            memoryBuilder: (args) => {
                const memory = new CompactingConversationSummaryMemory(summarizingModel, {
                    plainTextCompacting: args.plainText,
                    chatHistory: args.messageHistory,
                    tokenLimit: config.chatHistory?.tokenLimit ?? 8000,
                    conversationTokenThreshold: config.chatHistory?.conversationTokenThreshold ?? 75,
                    returnMessages: true,
                    memoryKey: "history",
                    inputKey: "inputToSave",
                    embeddings: embeddings,
                    compactionCallback: async (newLines, previousConversation) => {
                        for (const plugin of allCreatedPlugins) {
                            await plugin.memoryCompactionCallback(newLines, previousConversation);
                        }
                    }
                });
                return memory;
            }
        });

        const allTools = [...(await Promise.all(allCreatedPlugins.map(async (plugin) => plugin.tools()))).flat().map(tool => new MimirToolToLangchainTool(tool)), new MimirToolToLangchainTool(talkToUserTool)];

        let executor = SteppedAgentExecutor.fromAgentAndTools({
            agentName: shortName,
            memory: memory,
            agent: agent,
            tools: allTools,
            verbose: false,
            alwaysAllowTools: ['respondBack'],
        });

        const chatMemoryChain = new ChatMemoryChain(
            executor,
            memory,
            {
                completeTransactionTrigger: (message) => {
                    return message.output.complete;
                },
                messageFilter: (message) => {
                    return (!message.output.toolStep);
                }
            }
        );

        for (const plugin of allCreatedPlugins) {
            await plugin.init();
        }

        return {
            name: shortName,
            description: config.description,
            workspace: workspace,
            reset: reset,
            call: async (continuousMode, input, callback) => {
                const out = await chatMemoryChain.invoke({ continuousMode, ...input, functionResponseCallBack: callback });
                const agentResponse: ToolResponse | AgentToolRequest = JSON.parse(out.output);
                if (continuousMode) {
                    return {
                        output: toolResponseToAgentUserMessage(agentResponse as ToolResponse),
                        toolStep: () => false,
                        agentResponse: () => true
                    } as any
                } else {
                    return {
                        output: out.toolStep ? agentResponse as AgentToolRequest : toolResponseToAgentUserMessage(agentResponse as ToolResponse),
                        toolStep: () => out.toolStep === true,
                        agentResponse: () => out.toolStep !== true
                    } as AgentResponse
                }
            },

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

function toolResponseToAgentUserMessage(toolResponse: ToolResponse) {
    const firstEntry = toolResponse[0];
    if (firstEntry.type === 'text') {
        return JSON.parse(firstEntry.text) as AgentUserMessage
    }
    throw new Error("Cannot convert response to AgentUserMessage: " + JSON.stringify(toolResponse))
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
