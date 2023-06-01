
import { uniqueNamesGenerator, names } from 'unique-names-generator';

import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { BaseChain } from "langchain/chains";

import { Tool } from "langchain/tools";
import { PlainTextMessageSerializer } from '../parser/plain-text-parser/index.js';
import { WindowedConversationSummaryMemory } from '../memory/windowed-memory/index.js';
import { ScratchPadManager } from '../utils/scratch-pad.js';
import { CompletePlanStep, CreateHelper, EndTool, TalkToHelper, TalkToUserTool } from '../tools/core.js';
import { ThinkTool } from '../tools/think.js';
import { MimirChatConversationalAgent } from '../agent/index.js';
import { SteppedAgentExecutor } from '../executor/index.js';
import { ChatMemoryChain } from '../memory/transactional-memory-chain.js';
import { PREFIX_JOB } from '../agent/prompt.js';
import { BaseChatModel } from 'langchain/chat_models';
import { BaseLanguageModel } from "langchain/base_language";
import { Agent } from '../schema.js';

export type CreateAgentOptions = {
    profession: string,
    description: string,
    name?: string,
    model: BaseChatModel,
    summaryModel?: BaseChatModel,
    thinkingModel?: BaseLanguageModel,
    allowAgentCreation?: boolean,
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

        const messageSerializer = new PlainTextMessageSerializer();
        const summarizingModel = config.summaryModel ?? config.model;
        const innerMemory = new WindowedConversationSummaryMemory(summarizingModel, {
            returnMessages: true,
            memoryKey: "history",
            inputKey: "inputToSave",
            maxWindowSize: config.chatHistory?.maxTaskHistoryWindow ?? 6,
            messageSerializer: messageSerializer,
        });

        const scratchPad = new ScratchPadManager(10);
        const taskCompleteCommandName = "taskComplete";
        const controlTools = [new EndTool(taskCompleteCommandName), new TalkToUserTool()]

        const agentCommunicationTools = [];
        if (config.communicationWhitelist) {
            agentCommunicationTools.push(new TalkToHelper(this));
            if (config.allowAgentCreation) {
                agentCommunicationTools.push(new CreateHelper(this, config.model));
            }

        }
        const canCommunicateWithAgents = config.communicationWhitelist ?? false;
        let communicationWhitelist = undefined;
        if (Array.isArray(canCommunicateWithAgents)) {
            communicationWhitelist = canCommunicateWithAgents
        }
        const tools = [
            ...controlTools,
            ...(config.tools ?? []),
            ...agentCommunicationTools
        ];


        const memory = new WindowedConversationSummaryMemory(summarizingModel, {
            returnMessages: true,
            memoryKey: "chat_history",
            inputKey: "input",
            outputKey: "output",
            maxWindowSize: config.chatHistory?.maxChatHistoryWindow ?? 6,
            messageSerializer: messageSerializer,
        });

        const agent = MimirChatConversationalAgent.fromLLMAndTools(model, tools, {
            systemMessage: PREFIX_JOB(shortName, config.profession),
            taskCompleteCommandName: taskCompleteCommandName,
            memory: innerMemory,
            name: shortName,
            embedding: embeddings,
            scratchPad: scratchPad,
            helper: this,
            messageSerializer: messageSerializer,
            communicationWhitelist: communicationWhitelist
        });

        let executor = SteppedAgentExecutor.fromAgentAndTools({
            agentName: shortName,
            memory: memory,
            agent: agent,
            tools,
            verbose: false,
            alwaysAllowTools: ['talkToUser'],
        });

        const chatMemoryChain = new ChatMemoryChain(
            executor,
            memory,
            {
                completeTransactionTrigger: (message) => message.output.complete,
                messageFilter: (message) => (!message.output.toolResponse && message.input.input !== undefined)
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
