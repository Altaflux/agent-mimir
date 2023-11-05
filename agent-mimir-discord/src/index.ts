import { MimirAgentTypes } from "agent-mimir/agent";
import { AgentManager } from "agent-mimir/agent-manager"
import { Agent, AgentUserMessage, AgentUserMessageResponse, FILES_TO_SEND_FIELD, MimirPluginFactory } from "agent-mimir/schema";
import chalk from "chalk";
import { BaseChatModel } from 'langchain/chat_models/base';
import { BaseLanguageModel } from "langchain/base_language";
import { Tool } from "langchain/tools";
import { BaseChain } from "langchain/chains";
import { promises as fs } from 'fs';
import normalFs from 'fs';
import os from 'os';
import path from "path";
import { ChannelType, Client, GatewayIntentBits, Partials, REST, Routes, Events, Message } from 'discord.js';
import { Readable } from "stream";
import { finished } from "stream/promises";
import { SlashCommandBuilder } from "discord.js";
import { FileSystemChatHistory, FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import { Retry } from "./utils.js";


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
    chain?: BaseChain;
    definition?: {
        profession: string;
        agentType?: MimirAgentTypes;
        chatModel: BaseChatModel;
        taskModel?: BaseLanguageModel;
        constitution?: string;
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
    const body = Readable.fromWeb(response.body as any);
    const destination = path.join(os.tmpdir(), filename);
    const download_write_stream = normalFs.createWriteStream(destination);
    await finished(body.pipe(download_write_stream));
    return destination
}
export const run = async () => {

    const agentConfig: AgentMimirConfig = await getConfig();
    const workingDirectory = agentConfig.workingDirectory ?? await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-cli-'));
    console.log(`Using working directory ${workingDirectory}`);
    await fs.mkdir(workingDirectory, { recursive: true });

    const agentManager = new AgentManager({
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
                    messageHistory: new FileSystemChatHistory(path.join(workingDirectory, agentName, "chat-history.json")),
                    description: agentDefinition.description,
                    profession: agentDefinition.definition.profession,
                    tools: agentDefinition.definition.tools ?? [],
                    model: agentDefinition.definition.chatModel,
                    chatHistory: agentDefinition.definition.chatHistory,
                    communicationWhitelist: agentDefinition.definition.communicationWhitelist,
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

                const handleMessage = async (chainResponse: AgentUserMessageResponse, agentStack: Agent[]): Promise<{ finalUser: boolean, currentAgent: Agent | undefined, pendingMessage: PendingMessage | undefined }> => {
                    if (chainResponse.output.agentName) {
                        agentStack.push(currentAgent);
                        const discordMessage = `\`${currentAgent.name}\` is sending a message to \`${chainResponse.output.agentName}\`:\n\`\`\`${chainResponse.output.message}\`\`\`` +
                            `\nFiles provided: ${chainResponse.output.sharedFiles?.map(f => `\`${f.fileName}\``).join(", ") || "None"}`;
                        await sendDiscordResponse(msg, discordMessage);
                        return {
                            finalUser: false,
                            currentAgent: agentManager.getAgent(chainResponse.output.agentName),
                            pendingMessage: chainResponse.output
                        }
                    } else {
                        const isFinalUser = agentStack.length === 0;
                        if (!isFinalUser) {
                            const discordMessage = `\`${currentAgent.name}\` is replying back to \`${agentStack[agentStack.length - 1].name}\`:\n\`\`\`${chainResponse.output.message}\`\`\`` +
                                `\nFiles provided: ${chainResponse.output.sharedFiles?.map(f => `\`${f.fileName}\``).join(", ") || "None"}`;
                            await sendDiscordResponse(msg, discordMessage);
                        }
                        return {
                            finalUser: isFinalUser,
                            currentAgent: isFinalUser ? currentAgent : agentStack.pop()!,
                            pendingMessage: {
                                message: isFinalUser ? chainResponse.output.message : `${currentAgent.name} responded with: ${chainResponse.output.message}`,
                                sharedFiles: chainResponse.output.sharedFiles
                            }
                        }
                    }
                }

                let messasgeToSend: PendingMessage = pendingMessage ? {
                    message: pendingMessage.message,
                    sharedFiles: pendingMessage.sharedFiles
                } : { message: messageToAi, sharedFiles: loadedFiles };

                let chainResponse = await Retry(() => currentAgent.call(false, { input: messasgeToSend.message, [FILES_TO_SEND_FIELD]: messasgeToSend.sharedFiles }, async (name, input, functionResponse) => {
                    const toolResponse = `Agent: \`${currentAgent.name}\` called function: \`${name}\` \nInvoked with input: \n\`\`\`${input}\`\`\` \nResponded with: \n\`\`\`${functionResponse}\`\`\``;
                    await sendDiscordResponse(msg, toolResponse);
                }));
                if (chainResponse.agentResponse()) {
                    const routedMessage = await handleMessage(chainResponse, agentStack);
                    if (!routedMessage.currentAgent) {
                        agentStack.pop();
                        pendingMessage = {
                            message: "No agent found with that name.",
                            sharedFiles: []
                        };
                    } else {
                        currentAgent = routedMessage.currentAgent;
                        pendingMessage = routedMessage.pendingMessage;
                    }
                    if (routedMessage.finalUser) {
                        await sendChainResponse(msg, chainResponse.output);
                        break mainLoop;
                    }
                }
                while (chainResponse.toolStep()) {
                    chainResponse = await Retry(() => currentAgent.call(false, { continuousMode: false, continue: true }, async (name, input, functionResponse) => {
                        const toolResponse = `Agent: \`${currentAgent.name}\` called function: \`${name}\` \nInvoked with input: \n\`\`\`${input}\`\`\` \nResponded with: \n\`\`\`${functionResponse}\`\`\``;
                        await sendDiscordResponse(msg, toolResponse);
                    }));
                    if (chainResponse.agentResponse()) {
                        const routedMessage = await handleMessage(chainResponse, agentStack);
                        if (!routedMessage.currentAgent) {
                            agentStack.pop();
                            pendingMessage = {
                                message: "No agent found with that name.",
                                sharedFiles: []
                            };
                        } else {
                            currentAgent = routedMessage.currentAgent;
                            pendingMessage = routedMessage.pendingMessage;
                        }
       
                        if (routedMessage.finalUser) {
                            await sendChainResponse(msg, chainResponse.output);
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

async function sendChainResponse(msg: Message<boolean>, aiResponse: AgentUserMessage) {

    const response: AgentUserMessage = aiResponse;
    await sendDiscordResponse(msg, response.message, response.sharedFiles?.map(f => f.url));

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