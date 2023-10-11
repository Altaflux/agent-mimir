import { MimirAgentTypes } from "agent-mimir/agent";
import { AgentManager } from "agent-mimir/agent-manager"
import { AgentUserMessage, MimirPluginFactory, WorkspaceManager } from "agent-mimir/schema";
import chalk from "chalk";
import { BaseChatModel } from 'langchain/chat_models';
import { BaseLanguageModel } from "langchain/base_language";
import { Tool } from "langchain/tools";
import { BaseChain } from "langchain/chains";
import { chatWithAgent } from "./chat.js";
import { promises as fs } from 'fs';
import normalFs from 'fs';
import os from 'os';
import path from "path";
import { ChannelType, Client, GatewayIntentBits, MessageType, Partials } from 'discord.js';
import { REST, Routes } from 'discord.js';
import { Readable } from "stream";
import { finished } from "stream/promises";
export type AgentDefinition = {
    mainAgent?: boolean;
    description: string;
    chain?: BaseChain;
    definition?: {
        profession: string;
        agentType?: MimirAgentTypes;
        chatModel: BaseChatModel;
        summaryModel: BaseChatModel;
        taskModel?: BaseLanguageModel;
        constitution?: string;
        plugins?: MimirPluginFactory[];
        chatHistory?: {
            maxChatHistoryWindow?: number,
            maxTaskHistoryWindow?: number,
        }
        tools?: Tool[];
        communicationWhitelist?: string[] | boolean;
        allowAgentCreation?: boolean;
    },

}
type AgentMimirConfig = {
    agents: Record<string, AgentDefinition>;
    continuousMode?: boolean;
}

class FileSystemWorkspaceManager implements WorkspaceManager {

    workingDirectory: string;

    constructor(workDirectory: string) {
        this.workingDirectory = workDirectory;
    }

    async clearWorkspace(): Promise<void> {
        const files = await fs.readdir(this.workingDirectory);
        for (const file of files) {
            await fs.unlink(path.join(this.workingDirectory, file));
        }
    }

    async listFiles(): Promise<string[]> {
        const files = await fs.readdir(this.workingDirectory);
        return files;
    }
    async loadFileToWorkspace(fileName: string, url: string): Promise<void> {
        const destination = path.join(this.workingDirectory, fileName);
        await fs.copyFile(url, destination);
        console.debug(`Copied file ${url} to ${destination}`);
    }

    async getUrlForFile(fileName: string): Promise<string> {
        const file = path.join(this.workingDirectory, fileName);
        return file;
    }
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
// const downloadFile = (async (url: string, folder=".") => {
//     const res = await fetch(url);
//     if (!res.body) throw new Error(`unexpected response ${res.statusText}`);
//     //if (!fs.existsSync("downloads")) await fs.mkdir("downloads"); //Optional if you already have downloads directory
//     const destination = path.resolve("./downloads", folder);

//     const fileStream = normalFs.createWriteStream(destination, { flags: 'wx' });
//     await finished(Readable.fromWeb(res.body!).pipe(fileStream));
//   });
async function downloadFile(filename: string, link: string) {
    const response = await fetch(link);
    const body = Readable.fromWeb(response.body as any);
    const destination = path.join(os.tmpdir(), filename);
    const download_write_stream = normalFs.createWriteStream(destination);
    await finished(body.pipe(download_write_stream));
    return destination
}
export const run = async () => {

    const agentConfig: AgentMimirConfig = await getConfig();

    const agentManager = new AgentManager({
        workspaceManagerFactory: async (agent) => {
            const tempDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-cli-')), "workspace");
            await fs.mkdir(tempDir, { recursive: true });
            return new FileSystemWorkspaceManager(tempDir);
        }
    });
    const continousMode = agentConfig.continuousMode ?? false;

    const agents = await Promise.all(Object.entries(agentConfig.agents).map(async ([agentName, agentDefinition]) => {
        if (agentDefinition.definition) {
            const newAgent = {
                mainAgent: agentDefinition.mainAgent,
                name: agentName,
                agent: await agentManager.createAgent({
                    name: agentName,
                    description: agentDefinition.description,
                    profession: agentDefinition.definition.profession,
                    tools: agentDefinition.definition.tools ?? [],
                    model: agentDefinition.definition.chatModel,
                    summaryModel: agentDefinition.definition.summaryModel,
                    chatHistory: agentDefinition.definition.chatHistory,
                    communicationWhitelist: agentDefinition.definition.communicationWhitelist,
                    allowAgentCreation: agentDefinition.definition.allowAgentCreation,
                    constitution: agentDefinition.definition.constitution,
                    agentType: agentDefinition.definition.agentType,
                    plugins: agentDefinition.definition.plugins
                })
            }
            console.log(chalk.green(`Created agent "${agentName}" with profession "${agentDefinition.definition.profession}" and description "${agentDefinition.description}"`));
            return newAgent;
        } else {
            throw new Error(`Agent "${agentName}" has no definition.`);
        }

    }));

    const mainAgent = agents.length === 1 ? agents[0].agent : agents.find(a => a.mainAgent)?.agent;
    if (!mainAgent) {
        throw new Error("No main agent found");
    }

    console.log(chalk.green(`Using "${mainAgent.name}" as main agent`));
    //   await chatWithAgent(continousMode, mainAgent);

    const client = new Client(
        {
            intents: [GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.Guilds],
            partials: [Partials.Message, Partials.Channel]
        }
    );

    client.on('ready', () => {
        console.log(`Logged in as ${client!.user!.tag}!`);
    });

    client.on('messageCreate', async msg => {
        if (msg.author.bot) return;
        // const foo = msg.type !== MessageType.Reply && msg.reference
        if (msg.channel.type !== ChannelType.DM && !msg.mentions.has(client.user!)) {
            return;
        }
        await msg.channel.sendTyping();
        const typing = setInterval(() => msg.channel.sendTyping(), 5000);
        const loadedFiles = await Promise.all(msg.attachments.map(async (attachment) => {
            const response = await downloadFile(attachment.name, attachment.url);
            return {
                fileName: attachment.name,
                url: response
            }
        }));

        const messageToAi = msg.cleanContent.replaceAll(`@${client.user!.username}`, "").trim();
      
        const response: AgentUserMessage = JSON.parse((await mainAgent.agent.call({ continuousMode: true, input: messageToAi, filesToSend: loadedFiles })).output);
        clearInterval(typing);
        await msg.reply({
            content: response.message,
            files: (response.sharedFiles ?? []).map(f => f.url)
        });

    });
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'ping') {
            await interaction.reply('Pong!');
        }
    });
    client.login(process.env.DISCORD_TOKEN);
};

run();
