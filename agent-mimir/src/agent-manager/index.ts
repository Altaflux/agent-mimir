
import { uniqueNamesGenerator, names } from 'unique-names-generator';

import { OpenAIEmbeddings } from "langchain/embeddings/openai";

import { Tool } from "langchain/tools";
import { WindowedConversationSummaryMemory } from '../memory/windowed-memory/index.js';
import { ScratchPadPlugin } from '../plugins/scratch-pad.js';
import { EndTool, TalkToUserTool } from '../tools/core.js';
import { SteppedAgentExecutor } from '../executor/index.js';
import { ChatMemoryChain } from '../memory/transactional-memory-chain.js';

import { BaseChatModel } from 'langchain/chat_models';
import { BaseLanguageModel } from "langchain/base_language";
import { Agent, MimirAgentPlugin } from '../schema.js';

import { initializeAgent } from '../agent/index.js'
import { LangchainToolWrapper } from '../schema.js';
import { DEFAULT_CONSTITUTION } from '../agent/prompt.js';
import { TimePlugin } from '../plugins/time.js';
import { HelpersPlugin } from '../plugins/helpers.js';
import { MimirAgentTypes } from '../agent/index.js';
import { TagMemoryManager } from '../plugins/tag-memory/index.js';
import { AutomaticTagMemoryPlugin } from '../plugins/tag-memory/plugins.js';
import { CompactingConversationSummaryMemory } from '../memory/compacting-memory/index.js';
import { ChatMessageHistory } from 'langchain/memory';

export type CreateAgentOptions = {
    profession: string,
    description: string,
    agentType?: MimirAgentTypes,
    name?: string,
    model: BaseChatModel,
    plugins?: MimirAgentPlugin[],
    summaryModel?: BaseChatModel,
    thinkingModel?: BaseLanguageModel,
    allowAgentCreation?: boolean,
    constitution?: string,
    communicationWhitelist?: boolean | string[],
    chatHistory?: {
        maxChatHistoryWindow?: number,
        maxTaskHistoryWindow?: number,
    }
    tools?: Tool[],
}
export class AgentManager {

    private map: Map<string, Agent> = new Map();
    public constructor() { }

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
        const thinkingModel = config.thinkingModel ?? config.model;


        const summarizingModel = config.summaryModel ?? config.model;
        const tagManager = new TagMemoryManager(embeddings, config.summaryModel ?? config.model);
        const tagPlugin = new AutomaticTagMemoryPlugin(tagManager);


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
                communicationWhitelist: communicationWhitelist ?? null,
                allowAgentCreation: config.allowAgentCreation ?? false,
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

        const scratchPadPlugin = new ScratchPadPlugin(10);
        const timePlugin = new TimePlugin();
        const defaultPlugins = [scratchPadPlugin, timePlugin, tagPlugin, ...agentCommunicationPlugin, ...config.plugins ?? []] as MimirAgentPlugin[];
        //const defaultPlugins = [scratchPadPlugin, timePlugin,  ...agentCommunicationPlugin, ...config.plugins ?? []] as MimirAgentPlugin[];


        const talkToUserTool = new TalkToUserTool();

        const allPlugins = [...tools.map(tool => new LangchainToolWrapper(tool)), ...defaultPlugins];

        const innerMemory = new CompactingConversationSummaryMemory(summarizingModel, {
            returnMessages: true,
            memoryKey: "history",
            inputKey: "inputToSave",
            maxWindowSize: config.chatHistory?.maxTaskHistoryWindow ?? 6,
            compactionCallback: async (newLines, previousConversation) => {
                for (const plugin of allPlugins) {
                    await plugin.memoryCompactionCallback(newLines, previousConversation);
                }
            }
        });


        const agent = initializeAgent(config.agentType ?? "plain-text-agent", {
            llm: model,
            //memory: innerMemory,
            chatMemory: new ChatMessageHistory(),
            name: shortName,
            description: config.description,
            taskCompleteCommandName: taskCompleteCommandName,
            talkToUserTool: talkToUserTool,
            plugins: allPlugins,
            constitution: config.constitution ?? DEFAULT_CONSTITUTION,
            memoryBuilder: (memory) => {
                const innerMemory2 = new CompactingConversationSummaryMemory(summarizingModel, {
                    chatHistory: memory,
                    returnMessages: true,
                    memoryKey: "history",
                    inputKey: "inputToSave",
                    maxWindowSize: config.chatHistory?.maxTaskHistoryWindow ?? 6,
                    compactionCallback: async (newLines, previousConversation) => {
                        for (const plugin of allPlugins) {
                            await plugin.memoryCompactionCallback(newLines, previousConversation);
                        }
                    }
                });
                return innerMemory2;
            }
        });

        let executor = SteppedAgentExecutor.fromAgentAndTools({
            agentName: shortName,
            memory: memory,
            agent: agent,
            tools: [...tools, talkToUserTool],
            verbose: false,
            alwaysAllowTools: ['talkToUser'],
        });

        const chatMemoryChain = new ChatMemoryChain(
            executor,
            memory,
            {
                completeTransactionTrigger: (message) => {
                    return message.output.complete;
                },
                messageFilter: (message) => {
                    const foo = (!message.output.toolStep)
                    return foo;
                }
            }
        );

        this.map.set(shortName, { name: shortName, description: config.description, agent: chatMemoryChain });
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
