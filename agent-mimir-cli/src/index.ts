
import { OrchestratorBuilder } from "agent-mimir/communication/multi-agent";
import { PluginFactory } from "agent-mimir/plugins";
import chalk from "chalk";
import { StructuredTool } from "@langchain/core/tools";
import { chatWithAgent } from "./chat.js";
import { promises as fs } from 'fs';
import os from 'os';
import path from "path";
import { FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
//import { LangchainToolWrapperPluginFactory } from "agent-mimir/tools/langchain";
import { CodeAgentFactory, LocalPythonExecutor } from "agent-mimir/agent/code-agent";
import { BaseCheckpointSaver } from "@langchain/langgraph";
export type AgentDefinition = {
    mainAgent?: boolean;
    description: string;
    definition?: {
        profession: string;
        chatModel: BaseChatModel;
        taskModel?: BaseLanguageModel;
        constitution?: string;
        checkpointer?: BaseCheckpointSaver,
        plugins?: PluginFactory[];
        visionSupport?: 'openai';
        chatHistory?: {
            summaryModel?: BaseChatModel;
            tokenLimit?: number;
            conversationTokenThreshold?: number;
        }
        langChainTools?: StructuredTool[];
        communicationWhitelist?: string[] | boolean;
    },

}
type AgentMimirConfig = {
    agents: Record<string, AgentDefinition>;
    embeddings: Embeddings,
    workingDirectory?: string;
    continuousMode?: boolean;
}
const getConfig = async () => {
    if (process.env.MIMIR_CFG_PATH) {
        let cfgFile = path.join(process.env.MIMIR_CFG_PATH, 'mimir-cfg.js');
        const configFileExists = await fs.access(cfgFile, fs.constants.F_OK).then(() => true).catch(() => false);
        if (configFileExists) {
            console.log(chalk.green(`Loading configuration file`));
            const configFunction: Promise<AgentMimirConfig> | AgentMimirConfig = (await import(`file://${cfgFile}`)).default()
            return await Promise.resolve(configFunction);
        }
    }
    console.log(chalk.yellow("No config file found, using default ApenAI config"));
    return (await import("./default-config.js")).default();
};

export const run = async () => {

    const agentConfig: AgentMimirConfig = await getConfig();
    const workingDirectory = agentConfig.workingDirectory ?? await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-cli-'));
    console.log(`Using working directory ${workingDirectory}`);
    await fs.mkdir(workingDirectory, { recursive: true });


    const workspaceFactory = async (agentName: string) => {
        const tempDir = path.join(workingDirectory, agentName);
        await fs.mkdir(tempDir, { recursive: true });
        const workspace = new FileSystemAgentWorkspace(tempDir);
        await fs.mkdir(workspace.workingDirectory, { recursive: true });
        return workspace;
    }

    const orchestratorBuilder = new OrchestratorBuilder();
    const continousMode = agentConfig.continuousMode ?? false;
    const agents = await Promise.all(Object.entries(agentConfig.agents).map(async ([agentName, agentDefinition]) => {
        if (agentDefinition.definition) {
            const newAgent = {
                mainAgent: agentDefinition.mainAgent,
                name: agentName,
                agent: await orchestratorBuilder.initializeAgent( new CodeAgentFactory({
                    description: agentDefinition.description,
                    profession: agentDefinition.definition.profession,
                    model: agentDefinition.definition.chatModel,
                    visionSupport: agentDefinition.definition.visionSupport,
                    constitution: agentDefinition.definition.constitution,
                    checkpointer: agentDefinition.definition.checkpointer,
                    plugins: [...agentDefinition.definition.plugins ?? [], ], // ...(agentDefinition.definition.langChainTools ?? []).map(t => new LangchainToolWrapperPluginFactory(t))
                    workspaceFactory: workspaceFactory,
                    codeExecutor: (workspace) =>  new LocalPythonExecutor({workspace}),
                }), agentName, agentDefinition.definition.communicationWhitelist)
            }
            console.log(chalk.green(`Created agent "${agentName}" with profession "${agentDefinition.definition.profession}" and description "${agentDefinition.description}"`));
            return newAgent;
        } else {
            throw new Error(`Agent "${agentName}" has no definition`);
        }

    }));


    const mainAgent = agents.length === 1 ? agents[0].agent : agents.find(a => a.mainAgent)?.agent;
    if (!mainAgent) {
        throw new Error("No main agent found");
    }
    const chatAgentHandle = orchestratorBuilder.build(mainAgent);
    console.log(chalk.green(`Using "${mainAgent.name}" as main agent`));
    await chatWithAgent(chatAgentHandle, continousMode);
};

run();

