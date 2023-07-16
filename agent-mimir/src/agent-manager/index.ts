
import { uniqueNamesGenerator, names } from 'unique-names-generator';

import { OpenAIEmbeddings } from "langchain/embeddings/openai";

import { Tool } from "langchain/tools";
import { PlainTextMessageSerializer } from '../parser/plain-text-parser/index.js';
import { WindowedConversationSummaryMemory } from '../memory/windowed-memory/index.js';
import { ScratchPadManager } from '../utils/scratch-pad.js';
import { CreateHelper, EndTool, TalkToHelper, TalkToUserTool } from '../tools/core.js';
import { SteppedAgentExecutor } from '../executor/index.js';
import { ChatMemoryChain } from '../memory/transactional-memory-chain.js';

import { BaseChatModel } from 'langchain/chat_models';
import { BaseLanguageModel } from "langchain/base_language";
import { Agent } from '../schema.js';

import { createOpenAiFunctionAgent } from '../agent/nfunction.js';
import { createDefaultMimirAgent } from '../agent/default-agent.js';
import { LangchainToolWrapper } from '../index.js';
import { DEFAULT_CONSTITUTION } from '../agent/prompt.js';
export type CreateAgentOptions = {
    profession: string,
    description: string,
    name?: string,
    model: BaseChatModel,
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

        const messageSerializer = new PlainTextMessageSerializer();
        const summarizingModel = config.summaryModel ?? config.model;
        const innerMemory = new WindowedConversationSummaryMemory(summarizingModel, {
            returnMessages: true,
            memoryKey: "history",
            inputKey: "inputToSave",
            maxWindowSize: config.chatHistory?.maxTaskHistoryWindow ?? 6,
           // messageSerializer: messageSerializer,
        });

        const scratchPad = new ScratchPadManager(10);
        const taskCompleteCommandName = "taskComplete";
        const controlTools = [new EndTool(taskCompleteCommandName)]

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
           // messageSerializer: messageSerializer,
        });
        const talkToUserTool = new TalkToUserTool();
        const agent = createOpenAiFunctionAgent({
            llm: model,
            memory: innerMemory,
            name: shortName,
            taskCompleteCommandName: taskCompleteCommandName,
            talkToUserCommandName: talkToUserTool.name,
            plugins: tools.map(tool => new LangchainToolWrapper(tool)),
            constitution: config.constitution ?? DEFAULT_CONSTITUTION,
        });
        
        // const agent = createDefaultMimirAgent({
        //     llm: model,
        //     memory: innerMemory,
        //     name: shortName,
        //     taskCompleteCommandName: taskCompleteCommandName,
        //     talkToUserTool: talkToUserTool,
        //     plugins: tools.map(tool => new LangchainToolWrapper(tool)),
        //     constitution: config.constitution ?? DEFAULT_CONSTITUTION,
        // });

        // const agent = Gpt4FunctionAgent.fromLLMAndTools(model, tools, {
        //     systemMessage: PREFIX_JOB(shortName, config.profession),
        //     taskCompleteCommandName: taskCompleteCommandName,
        //     memory: innerMemory,
        //     name: shortName,
        //     embedding: embeddings,
        //     scratchPad: scratchPad,
        //     talkToUserTool: talkToUserTool,
        //     helper: this,
        //     messageSerializer: messageSerializer,
        //     communicationWhitelist: communicationWhitelist
        // });

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
                messageFilter: (message) =>{
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
