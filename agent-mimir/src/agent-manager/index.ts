
import { uniqueNamesGenerator, names } from 'unique-names-generator';

import { OpenAIEmbeddings } from "langchain/embeddings/openai";

import { Tool } from "langchain/tools";
import { WindowedConversationSummaryMemory } from '../memory/windowed-memory/index.js';
import { EndTool, TalkToUserTool } from '../tools/core.js';
import { SteppedAgentExecutor } from '../executor/index.js';
import { ChatMemoryChain } from '../memory/transactional-memory-chain.js';

import { BaseChatModel } from 'langchain/chat_models';
import { Agent, MimirAgentPlugin,  MimirPluginFactory, WorkspaceManagerFactory } from '../schema.js';

import { initializeAgent } from '../agent/index.js'
import { LangchainToolWrapper } from '../schema.js';
import { DEFAULT_CONSTITUTION } from '../agent/prompt.js';
import { TimePlugin } from '../plugins/time.js';
import { HelpersPlugin } from '../plugins/helpers.js';
import { MimirAgentTypes } from '../agent/index.js';
import { AutomaticTagMemoryPlugin } from '../plugins/tag-memory/plugins.js';
import { CompactingConversationSummaryMemory } from '../memory/compacting-memory/index.js';
import { ChatMessageHistory } from 'langchain/memory';
import { BaseChatMessageHistory, BaseMessage } from 'langchain/schema';


export type CreateAgentOptions = {
    profession: string,
    description: string,
    agentType?: MimirAgentTypes,
    name?: string,
    model: BaseChatModel,
    plugins?: MimirPluginFactory[],
    summaryModel?: BaseChatModel,
    constitution?: string,
    communicationWhitelist?: boolean | string[],
    chatHistory?: {
        maxChatHistoryWindow?: number,
        maxTaskHistoryWindow?: number,
    }
    tools?: Tool[],
    messageHistory: BaseChatMessageHistory,
    
}

export type ManagerConfig = {

    workspaceManagerFactory: WorkspaceManagerFactory
}
export class AgentManager {

    private map: Map<string, Agent> = new Map();
    public constructor(private managerConfig: ManagerConfig) { }

    public async createAgentFromChain(config: Agent): Promise<Agent> {
        this.map.set(config.name, config);
        return this.map.get(config.name)!;
    }

    public async createAgent(config: CreateAgentOptions): Promise<Agent> {


        const shortName = config.name ?? uniqueNamesGenerator({
            dictionaries: [names, names],
            length: 2
        });

        const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.AGENT_OPENAI_API_KEY });
        const model = config.model;

        const summarizingModel = config.summaryModel ?? config.model;

        const tagPlugin = new AutomaticTagMemoryPlugin(embeddings, config.summaryModel ?? config.model);


        const taskCompleteCommandName = "taskComplete";
        const controlTools = [new EndTool(taskCompleteCommandName)]

        const agentCommunicationPlugin = [];
        const canCommunicateWithAgents = config.communicationWhitelist ?? false;
        let communicationWhitelist = undefined;
        if (Array.isArray(canCommunicateWithAgents)) {
            communicationWhitelist = canCommunicateWithAgents
        }

        if (config.communicationWhitelist) {
            const helpersPlugin = new HelpersPlugin({
                name: shortName,
                helperSingleton: this,
                model: model,
                communicationWhitelist: communicationWhitelist ?? null
            });

            agentCommunicationPlugin.push(helpersPlugin);
        }


        const tools = [
            ...controlTools,
            ...(config.tools ?? []),

        ];


        const memory = new WindowedConversationSummaryMemory(summarizingModel, {
            returnMessages: true,
            memoryKey: "chat_history",
            inputKey: "input",
            outputKey: "output",
            maxWindowSize: config.chatHistory?.maxChatHistoryWindow ?? 6
        });

        const timePlugin = new TimePlugin();

        const workspace = await this.managerConfig.workspaceManagerFactory(shortName);
        const configurablePlugins = config.plugins?.map(plugin => plugin.create({ workingDirectory: workspace.workingDirectory, agentName: shortName }));
        const defaultPlugins = [timePlugin, ...agentCommunicationPlugin, ...configurablePlugins ?? []] as MimirAgentPlugin[];

        const talkToUserTool = new TalkToUserTool(workspace);

        const allPlugins = [...tools.map(tool => new LangchainToolWrapper(tool)), ...defaultPlugins];


        const agent = initializeAgent(config.agentType ?? "plain-text-agent", {
            llm: model,
            name: shortName,
            description: config.description,
            taskCompleteCommandName: taskCompleteCommandName,
            talkToUserTool: talkToUserTool,
            workspaceManager: workspace,
            plugins: allPlugins,
            constitution: config.constitution ?? DEFAULT_CONSTITUTION,
            chatMemory: config.messageHistory,
            memoryBuilder: (args) => {
                const memory = new CompactingConversationSummaryMemory(summarizingModel, {
                    plainTextCompacting: args.plainText,
                    chatHistory: args.messageHistory,
                    returnMessages: true,
                    memoryKey: "history",
                    inputKey: "inputToSave",
                    embeddings: embeddings,
                    compactionCallback: async (newLines, previousConversation) => {
                        for (const plugin of allPlugins) {
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
            tools: [...allPlugins.map((plugin) => plugin.tools()).flat(), talkToUserTool],
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

        for (const plugin of allPlugins) {
            await plugin.init();
        }

        this.map.set(shortName, { name: shortName, description: config.description, agent: chatMemoryChain, workspace: workspace });
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