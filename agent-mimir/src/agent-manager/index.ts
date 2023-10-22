
import { uniqueNamesGenerator, names } from 'unique-names-generator';

import { OpenAIEmbeddings } from "langchain/embeddings/openai";

import { Tool } from "langchain/tools";
import { EndTool, TalkToUserTool } from '../tools/core.js';
import { SteppedAgentExecutor } from '../executor/index.js';
import { ChatMemoryChain } from '../memory/transactional-memory-chain.js';

import { BaseChatModel } from 'langchain/chat_models';
import { Agent, AgentResponse, AgentToolRequest, AgentUserMessage, MimirAgentPlugin, MimirPluginFactory, WorkspaceManagerFactory } from '../schema.js';

import { initializeAgent } from '../agent/index.js'
import { LangchainToolWrapper } from '../schema.js';
import { DEFAULT_CONSTITUTION } from '../agent/prompt.js';
import { TimePlugin } from '../plugins/time.js';
import { HelpersPlugin } from '../plugins/helpers.js';
import { MimirAgentTypes } from '../agent/index.js';
import { AutomaticTagMemoryPlugin } from '../plugins/tag-memory/plugins.js';
import { CompactingConversationSummaryMemory } from '../memory/compacting-memory/index.js';
import { BaseChatMessageHistory } from 'langchain/schema';
import { NoopMemory } from '../memory/noopMemory.js';


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
        tokenLimit?: number;
        conversationTokenThreshold?: number;
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
            // ...controlTools,
            ...(config.tools ?? []),

        ];


        // const memory = new WindowedConversationSummaryMemory(summarizingModel, {
        //     returnMessages: true,
        //     memoryKey: "chat_history",
        //     inputKey: "input",
        //     outputKey: "output",
        //     maxWindowSize: config.chatHistory?.maxChatHistoryWindow ?? 6
        // });
        const memory = new NoopMemory({
            returnMessages: true,
            memoryKey: "chat_history",
            inputKey: "input",
            outputKey: "output",
        });

        const timePlugin = new TimePlugin();

        const workspace = await this.managerConfig.workspaceManagerFactory(shortName);
        const configurablePlugins = config.plugins?.map(plugin => plugin.create({ workingDirectory: workspace.workingDirectory, agentName: shortName }));
        const defaultPlugins = [timePlugin, ...agentCommunicationPlugin, ...configurablePlugins ?? []] as MimirAgentPlugin[];

        const talkToUserTool = new TalkToUserTool(workspace);

        const allPlugins = [...tools.map(tool => new LangchainToolWrapper(tool)), ...defaultPlugins];

        const reset = async () => {
            await Promise.all(allPlugins.map(async plugin => await plugin.clear()));
            await workspace.clearWorkspace();
            await config.messageHistory.clear()
        };
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