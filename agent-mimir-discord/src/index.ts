import { AgentManager } from "agent-mimir/agent-manager"
import { Agent, AgentUserMessageResponse, FILES_TO_SEND_FIELD, MimirPluginFactory } from "agent-mimir/schema";
import chalk from "chalk";
import { Tool } from "@langchain/core/tools";

import { promises as fs } from 'fs';
import normalFs from 'fs';
import os from 'os';
import path from "path";
import { ChannelType, Client, GatewayIntentBits, Partials, REST, Routes, Events, Message } from 'discord.js';
import { Readable } from "stream";
import { finished } from "stream/promises";
import { SlashCommandBuilder } from "discord.js";
import { FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import { Retry } from "./utils.js";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

function splitStringInChunks(str: string) {
    const chunkSize = 1900;
    let chunks = [];

    for (let i = 0; i < str.length; i += chunkSize) {
        chunks.push(str.slice(i, i + chunkSize));
    }

    return chunks;
}

export type AgentDefinition = {
    mainAgent?: boolean;
    description: string;
    definition?: {
        profession: string;
        chatModel: BaseChatModel;
        taskModel?: BaseLanguageModel;
        constitution?: string;
        visionSupport?: 'openai';
        plugins?: MimirPluginFactory[];
        chatHistory: {
            summaryModel: BaseChatModel;
            tokenLimit?: number;
            conversationTokenThreshold?: number;
        }
        tools?: Tool[];
        communicationWhitelist?: string[] | boolean;
    },

}
type AgentMimirConfig = {
    agents: Record<string, AgentDefinition>;
    embeddings: Embeddings;
    continuousMode?: boolean;
    workingDirectory?: string;
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
    console.log(chalk.yellow("No config file found, using default OpenAI config"));
    return (await import("./default-config.js")).default();
};

async function downloadFile(filename: string, link: string) {
    const response = await fetch(link);
    const body = Readable.fromWeb(response.body! as any);
    const destination = path.join(os.tmpdir(), filename);
    const download_write_stream = normalFs.createWriteStream(destination);
    await finished(body.pipe(download_write_stream as any));
    return destination
}


export const run = async () => {

    const agentConfig: AgentMimirConfig = await getConfig();
    const workingDirectory = agentConfig.workingDirectory ?? await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-cli-'));
    console.log(`Using working directory ${workingDirectory}`);
    await fs.mkdir(workingDirectory, { recursive: true });

    const agentManager = new AgentManager({
        embeddings: agentConfig.embeddings,
        workspaceManagerFactory: async (agent) => {
            const tempDir = path.join(workingDirectory, agent);
            await fs.mkdir(tempDir, { recursive: true });
            const workspace = new FileSystemAgentWorkspace(tempDir);
            await fs.mkdir(workspace.workingDirectory, { recursive: true });
            return workspace;
        }
    });

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
                    visionSupport: agentDefinition.definition.visionSupport,
                    communicationWhitelist: agentDefinition.definition.communicationWhitelist,
                    constitution: agentDefinition.definition.constitution,
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

    const client = new Client(
        {
            intents: [GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.Guilds],
            partials: [Partials.Message, Partials.Channel]
        }
    );
    const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

    const resetCommand = new SlashCommandBuilder().setName('reset')
        .setDescription('Resets the agent to a clean state.');

    const commands = [resetCommand];


    client.on('ready', async () => {
        console.log(`Logged in as ${client!.user!.tag}!`);
        await (async () => {
            try {
                console.log(`Started refreshing ${commands.length} application (/) commands.`);
                const data = await rest.put(Routes.applicationCommands(client.user?.id!), { body: commands });
                console.log(`Successfully reloaded ${JSON.stringify(data)} application (/) commands.`);
            } catch (error) {
                // And of course, make sure you catch and log any errors!
                console.error(error);
            }
        })();

    });

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isChatInputCommand()) return;
        await interaction.deferReply();
        if (interaction.commandName === 'reset') {
            try {
                for (const agent of agents) {
                    await agent.agent.reset();
                }
            } catch (e) {
                console.error(e);
                await interaction.editReply('There was an error resetting the agent.');
            }
            await interaction.editReply('The agents have been reset!');
        }
        if (interaction.commandName === 'image') {
            await interaction.editReply('Success!');
        }


    });
    const messageHandler = async (msg: Message<boolean>) => {
        if (msg.author.bot) return;

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
        let currentAgent = mainAgent;
        const messageToAi = msg.cleanContent.replaceAll(`@${client.user!.username}`, "").trim();
        let pendingMessage: PendingMessage | undefined = undefined;
        const agentStack: Agent[] = [];
        try {
            mainLoop: while (true) {

                const handleMessage = async (chainResponse: AgentUserMessageResponse, agentStack: Agent[]): Promise<{ conversationComplete: boolean, currentAgent: Agent, pendingMessage: PendingMessage | undefined }> => {
                    if (chainResponse.output.agentName) {

                        const discordMessage = `\`${currentAgent.name}\` is sending a message to \`${chainResponse.output.agentName}\`:\n\`\`\`${chainResponse.output.message}\`\`\`` +
                            `\nFiles provided: ${chainResponse.output.sharedFiles?.map(f => `\`${f.fileName}\``).join(", ") || "None"}`;
                        await sendDiscordResponse(msg, discordMessage);
                        const newAgent = agentManager.getAgent(chainResponse.output.agentName);
                        if (!newAgent) {
                            return {
                                conversationComplete: false,
                                currentAgent: currentAgent,
                                pendingMessage: {
                                    message: "No agent found with that name.",
                                    sharedFiles: []
                                }
                            }
                        }
                        agentStack.push(currentAgent);
                        return {
                            conversationComplete: false,
                            currentAgent: newAgent,
                            pendingMessage: chainResponse.output
                        }
                    } else {
                        const isFinalUser = agentStack.length === 0;
                        if (!isFinalUser) {
                            const discordMessage = `\`${currentAgent.name}\` is replying back to \`${agentStack[agentStack.length - 1].name}\`:\n\`\`\`${chainResponse.output.message}\`\`\`` +
                                `\nFiles provided: ${chainResponse.responseAttributes[FILES_TO_SEND_FIELD]?.map((f:any) => `\`${f.fileName}\``).join(", ") || "None"}`;
                            await sendDiscordResponse(msg, discordMessage);
                        } else {
                            await sendDiscordResponse(msg, chainResponse.output.message, chainResponse.responseAttributes[FILES_TO_SEND_FIELD]?.map((f:any) => f.url));
                        }
                        return {
                            conversationComplete: isFinalUser,
                            currentAgent: isFinalUser ? currentAgent : agentStack.pop()!,
                            pendingMessage: {
                                message: isFinalUser ? chainResponse.output.message : `${currentAgent.name} responded with: ${chainResponse.output.message}`,
                                sharedFiles: chainResponse.responseAttributes[FILES_TO_SEND_FIELD]
                            }
                        }
                    }
                }

                let messasgeToSend: PendingMessage = pendingMessage ? {
                    message: pendingMessage.message,
                    sharedFiles: pendingMessage.sharedFiles
                } : { message: messageToAi, sharedFiles: loadedFiles };

                let chainResponse = await Retry(() => currentAgent.call(false, messasgeToSend.message, { [FILES_TO_SEND_FIELD]: messasgeToSend.sharedFiles }, async (calls) => {
                    for (const call of calls ) {
                        const toolResponse = `Agent: \`${currentAgent.name}\` called function: \`${call.name}\` \nInvoked with input: \n\`\`\`${call.input}\`\`\` \nResponded with: \n\`\`\`${call.response.substring(0, 3000)}\`\`\``;
                        await sendDiscordResponse(msg, toolResponse);
                    }
           
                }));
                if (chainResponse.type == "agentResponse") {
                    const routedMessage = await handleMessage(chainResponse, agentStack);
                    currentAgent = routedMessage.currentAgent;
                    pendingMessage = routedMessage.pendingMessage;
                    if (routedMessage.conversationComplete) {
                        break mainLoop;
                    }
                }
                while (chainResponse.type == "toolRequest") {
                    chainResponse = await Retry(() => currentAgent.call(false, null, {}, async (calls) => {
                        for (const call of calls ) {
                            const toolResponse = `Agent: \`${currentAgent.name}\` called function: \`${call.name}\` \nInvoked with input: \n\`\`\`${call.input}\`\`\` \nResponded with: \n\`\`\`${call.response.substring(0, 3000)}\`\`\``;
                            await sendDiscordResponse(msg, toolResponse);
                        }
                        // const toolResponse = `Agent: \`${currentAgent.name}\` called function: \`${name}\` \nInvoked with input: \n\`\`\`${input}\`\`\` \nResponded with: \n\`\`\`${functionResponse.substring(0, 3000)}\`\`\``;
                        // await sendDiscordResponse(msg, toolResponse);
                    }));
                    if (chainResponse.type == "agentResponse") {
                        const routedMessage = await handleMessage(chainResponse, agentStack);
                        currentAgent = routedMessage.currentAgent;
                        pendingMessage = routedMessage.pendingMessage;

                        if (routedMessage.conversationComplete) {
                            break mainLoop;
                        }
                    }
                }
            }

        } finally {
            clearInterval(typing);
        }

    }
    client.on(Events.MessageCreate, async msg => {
        try {
            messageHandler(msg);
        } catch (e) {
            console.error("An error occured while processing a message.", e)
            await msg.reply({
                content: "An error occured while processing your message.\n" + e,
            });
        }
    });

    client.login(process.env.DISCORD_TOKEN);
};

run();

type PendingMessage = {
    sharedFiles?: {
        url: string;
        fileName: string;
    }[],
    message: string;
}

async function sendDiscordResponse(msg: Message<boolean>, message: string, attachments?: string[]) {
    const chunks = splitStringInChunks(message);
    for (let i = 0; i < chunks.length; i++) {
        const files = (i === chunks.length - 1) ? (attachments ?? []) : [];
        await msg.reply({
            content: chunks[i],
            files: files
        });
    }
}