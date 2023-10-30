
import { uniqueNamesGenerator, names } from 'unique-names-generator';

import { OpenAIEmbeddings } from "langchain/embeddings/openai";

import { StructuredTool, Tool } from "langchain/tools";
import { TalkToUserTool } from '../tools/core.js';
import { SteppedAgentExecutor } from '../executor/index.js';
import { ChatMemoryChain } from '../memory/transactional-memory-chain.js';

import { BaseChatModel } from 'langchain/chat_models';
import { Agent, AgentResponse, AgentToolRequest, AgentUserMessage, MimirAgentPlugin, MimirPluginFactory, PluginContext, WorkspaceManagerFactory } from '../schema.js';

import { initializeAgent } from '../agent/index.js'
import { DEFAULT_CONSTITUTION } from '../agent/prompt.js';
import { TimePluginFactory } from '../plugins/time.js';
import { HelpersPluginFactory } from '../plugins/helpers.js';
import { MimirAgentTypes } from '../agent/index.js';
import { ManualTagMemoryPluginFactory } from '../plugins/tag-memory/plugins.js';
import { CompactingConversationSummaryMemory } from '../memory/compacting-memory/index.js';
import { BaseChatMessageHistory } from 'langchain/schema';
import { NoopMemory } from '../memory/noopMemory.js';


export type CreateAgentOptions = {
    profession: string,
    description: string,
    agentType?: MimirAgentTypes,
    name: string,
    model: BaseChatModel,
    plugins?: MimirPluginFactory[],
    summaryModel?: BaseChatModel,
    constitution?: string,
    communicationWhitelist?: boolean | string[],
    chatHistory?: {
        tokenLimit?: number;
        conversationTokenThreshold?: number;
    }
    tools?: Tool[],
    messageHistory: BaseChatMessageHistory,

}

export type ManagerConfig = {

    workspaceManagerFactory: WorkspaceManagerFactory,
}
export class AgentManager {

    private map: Map<string, Agent> = new Map();
    public constructor(private managerConfig: ManagerConfig) { }

    public async createAgent(config: CreateAgentOptions): Promise<Agent> {


        const shortName = config.name ?? uniqueNamesGenerator({
            dictionaries: [names, names],
            length: 2
        });

        const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });
        const model = config.model;

        const summarizingModel = config.summaryModel ?? config.model;

        const tagPlugin = new ManualTagMemoryPluginFactory(embeddings, config.summaryModel ?? config.model);

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
        const defaultPluginsFactories = [timePlugin, tagPlugin, ...agentCommunicationPlugin, ...config.plugins ?? []];

        const allPluginFactories: MimirPluginFactory[] = [...tools.map(tool => new LangchainToolWrapperPluginFactory(tool)), ...defaultPluginsFactories];
        const allCreatedPlugins = allPluginFactories.map(factory => factory.create({ workingDirectory: workspace.workingDirectory, agentName: shortName, persistenceDirectory: workspace.pluginDirectory(factory.name) }));
        const talkToUserTool = new TalkToUserTool(workspace);

        const reset = async () => {
            await Promise.all(allCreatedPlugins.map(async plugin => await plugin.clear()));
            await workspace.reset();
            await config.messageHistory.clear()
        };
        const agent = initializeAgent(config.agentType ?? "plain-text-agent", {
            llm: model,
            name: shortName,
            description: config.description,
            taskCompleteCommandName: taskCompleteCommandName,
            talkToUserTool: talkToUserTool,
            workspaceManager: workspace,
            plugins: allCreatedPlugins,
            constitution: config.constitution ?? DEFAULT_CONSTITUTION,
            chatMemory: config.messageHistory,
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

        let executor = SteppedAgentExecutor.fromAgentAndTools({
            agentName: shortName,
            memory: memory,
            agent: agent,
            tools: [...allCreatedPlugins.map((plugin) => plugin.tools()).flat(), talkToUserTool],
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

        this.map.set(shortName, {
            name: shortName,
            description: config.description,
            workspace: workspace,
            reset: reset,
            call: async (continuousMode, input, callback) => {
                const out = await chatMemoryChain.call({ continuousMode, ...input, functionResponseCallBack: callback });
                if (continuousMode) {
                    return {
                        output: JSON.parse(out.output) as AgentUserMessage,
                        toolStep: () => false,
                        agentResponse: () => true
                    } as any
                } else {
                    return {
                        output: JSON.parse(out.output) as AgentToolRequest | AgentUserMessage,
                        toolStep: () => out.toolStep === true,
                        agentResponse: () => out.toolStep !== true
                    } as AgentResponse
                }
            },

        });
        return this.map.get(shortName)!;
    }

    public getAgent(shortName: string): Agent | undefined {
        const agent = this.map.get(shortName);
        return agent
    }

    public getAllAgents(): Agent[] {
        return Array.from(this.map.values())
    }

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

    tools(): StructuredTool[] {
        return [this.tool];
    }
}
