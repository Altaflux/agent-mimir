import { AgentManager } from "agent-mimir";
import chalk from "chalk";

import { BaseChatModel } from 'langchain/chat_models';
import { BaseLanguageModel } from "langchain/base_language";
import { Tool } from "langchain/tools";
import { chatWithAgent } from "./chat.js";
import fs from "fs";
import path from "path";

export type AgentDefinition = {
    mainAgent?: boolean;
    profession: string;
    chatModel: BaseChatModel;
    summaryModel: BaseChatModel;
    taskModel?: BaseLanguageModel;
    chatHistory?: {
        maxChatHistoryWindow?: number,
        maxTaskHistoryWindow?: number,
    }
    tools?: Tool[];
    communicationWhitelist?: string[] | boolean;
}
type AgentMimirConfig = {
    agents: Record<string, AgentDefinition>;
    continuousMode?: boolean;
}
export const run = async () => {

    let agentConfig: AgentMimirConfig;
   
    const configDirectory = process.env.CONFIG_LOCAION ?? './mimir-config';
    let cfgFile = "";
    if (path.isAbsolute(configDirectory)) {
        cfgFile = path.join(configDirectory, 'mimir-cfg.js');
    } else {
        cfgFile = path.join(process.cwd(), '../', configDirectory, 'mimir-cfg.js');
    }

    if (fs.existsSync(cfgFile)) {
        agentConfig = (await import(`file://${cfgFile}`)).default()
    } else {
        console.log(chalk.yellow("No config file found, using default ApenAI config"));
        agentConfig = (await import("./default-config.js")).default();
    }

    const agentManager = new AgentManager();
    const continousMode = agentConfig.continuousMode ?? false;
    const agents = await Promise.all(Object.entries(agentConfig.agents).map(async ([agentName, agentDefinition]) => {
        const newAgent = {
            mainAgent: agentDefinition.mainAgent,
            name: agentName,
            agent: await agentManager.createAgent({
                name: agentName,
                profession: agentDefinition.profession,
                tools: agentDefinition.tools ?? [],
                model: agentDefinition.chatModel,
                summaryModel: agentDefinition.summaryModel,
                thinkingModel: agentDefinition.taskModel ?? agentDefinition.chatModel,
                chatHistory: agentDefinition.chatHistory,
                communicationWhitelist : agentDefinition.communicationWhitelist,
            })
        }
        console.log(chalk.green(`Created agent "${agentName}" with profession "${agentDefinition.profession}"`));
        return newAgent;
    }));

    const mainAgent = agents.length === 1 ? agents[0].agent : agents.find(a => a.mainAgent)?.agent;
    if (!mainAgent) {
        throw new Error("No main agent found");
    }

    console.log(chalk.green(`Using "${mainAgent.name}" as main agent`));
    await chatWithAgent(continousMode, mainAgent);
};

run();