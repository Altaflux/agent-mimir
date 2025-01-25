import { AgentManager } from "agent-mimir/agent-manager"
import { Agent, AgentResponse, AgentUserMessageResponse, FILES_TO_SEND_FIELD, MimirPluginFactory, ToolResponseInfo } from "agent-mimir/schema";
import chalk from "chalk";
import { Tool } from "@langchain/core/tools";

import { promises as fs } from 'fs';
import normalFs from 'fs';
import os from 'os';
import path from "path";
import { ChannelType, Client, GatewayIntentBits, Partials, REST, Routes, Events, Message, Interaction, CacheType, ChatInputCommandInteraction } from 'discord.js';
import { Readable } from "stream";
import { finished } from "stream/promises";
import { SlashCommandBuilder } from "discord.js";
import { FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import { Retry } from "./utils.js";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentHandle, AgentInvoke, AgentToAgentMessage, AgentToolRequest, AgentUserMessage, HandleMessageResult, IntermediateAgentResponse } from "agent-mimir/chat";

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

    const chatAgentHandle: AgentHandle = new AgentHandle(agentManager, mainAgent);

    const client = new Client(
        {
            intents: [GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.Guilds],
            partials: [Partials.Message, Partials.Channel]
        }
    );
    const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

    const resetCommand = new SlashCommandBuilder().setName('reset')
        .setDescription('Resets the agent to a clean state.');

    const agentCommands = mainAgent.commands.map(c => {
        const discordCommand = new SlashCommandBuilder().setName(c.name);
        if (c.description) {
            discordCommand.setDescription((c.description.length > 90) ? c.description.slice(0, 90 - 1) + '&hellip;' : c.description);
        }

        (c.arguments ?? []).forEach(arg => {
            discordCommand.addStringOption(option => {
                option.setName(arg.name);
                option.setRequired(arg.required);
                if (arg.description) {
                    option.setDescription((arg.description.length > 90) ? arg.description.slice(0, 90 - 1) + '&hellip;' : arg.description);
                }
                return option
            })
        })
        return discordCommand;
    })

    const commands = [resetCommand, ...agentCommands];


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

        if (mainAgent.commands.map(c => c.name).includes(interaction.commandName)) {
            let commandArguments = interaction.options.data.reduce((l, r) => {
                return {
                    ...l,
                    [r.name]: r.value
                }
            }, {})
            const agentInvoke: AgentInvoke = async function* (agent) {
                const generator = agent.handleCommand({
                    name: interaction.commandName,
                    arguments: commandArguments
                })
                let result: IteratorResult<ToolResponseInfo, AgentResponse>;
                while (!(result = await generator.next()).done) {
                    yield result.value;
                }
                return result.value
            }

            messageHandler(agentInvoke, async (message, attachments?: string[]) => {
                await sendDiscordResponseFromCommand(interaction, message, attachments);
            })
        }


    });
    const messageHandler = async (msg: AgentInvoke, sendResponse: SendResponse) => {
  
        let toolCallback: FunctionResponseCallBack = async (call) => {
            const toolResponse = `Agent: \`${call.agentName}\`  \n---\nCalled function: \`${call.name}\` \nResponded with: \n\`\`\`${call.response.substring(0, 3000)}\`\`\``;
            await sendResponse(toolResponse);
        };
        let intermediateResponseHandler = async (chainResponse: IntermediateAgentResponse) => {
            if (chainResponse.type === "toolResponse") {
                toolCallback({
                    agentName: chainResponse.agentName,
                    name: chainResponse.name,
                    response: chainResponse.response
                });
            } else {
                const discordMessage = `\`${chainResponse.sourceAgent}\` is sending a message to \`${chainResponse.destinationAgent}\`:\n\`\`\`${chainResponse.message}\`\`\`` +
                `\nFiles provided: ${chainResponse.responseAttributes[FILES_TO_SEND_FIELD]?.map((f: any) => `\`${f.fileName}\``).join(", ") || "None"}`;
                await sendResponse(discordMessage, chainResponse.responseAttributes[FILES_TO_SEND_FIELD]?.map((f: any) => f.url));
            }
        };

        let result: IteratorResult<IntermediateAgentResponse, HandleMessageResult>;
        const generator =  chatAgentHandle.handleMessage(msg)

        while (!(result = await generator.next()).done) {
            intermediateResponseHandler(result.value);
        }

        if (result.value.type === "agentResponse") {
            await sendResponse(result.value.message, result.value.responseAttributes[FILES_TO_SEND_FIELD]?.map((f: any) => f.url));
            return
        } else {
            while (result.value.type === "toolRequest") {
                await sendResponse(result.value.message ?? "TOOL INVOKED! NO MESSAGE", []);
                const generator = chatAgentHandle.handleMessage((agent)=> agent.call(null, {}));
                while (!(result = await generator.next()).done) {
                    intermediateResponseHandler(result.value);
                }
            }
            await sendResponse(result.value.message, result.value.responseAttributes[FILES_TO_SEND_FIELD]?.map((f: any) => f.url));
        }
    }
    client.on(Events.MessageCreate, async msg => {
        const typing = setInterval(() => msg.channel.sendTyping(), 5000);
        try {

            const agentInvoke: AgentInvoke = async function* (agent: Agent) {
                const messageToAi = msg.cleanContent.replaceAll(`@${client.user!.username}`, "").trim();
                const loadedFiles = await Promise.all(msg.attachments.map(async (attachment) => {
                    const response = await downloadFile(attachment.name, attachment.url);
                    return {
                        fileName: attachment.name,
                        url: response
                    }
                }));
                const messageToSend = { message: messageToAi, sharedFiles: loadedFiles };
                const generator = agent.call(messageToSend.message, { [FILES_TO_SEND_FIELD]: messageToSend.sharedFiles })

                let result: IteratorResult<ToolResponseInfo, AgentResponse>;
                while (!(result = await generator.next()).done) {
                    yield result.value;
                }
                return result.value
            }

            if (msg.author.bot) return;

            if (msg.channel.type !== ChannelType.DM && !msg.mentions.has(client.user!)) {
                return;
            }
            messageHandler(agentInvoke, async (message: string, attachments?: string[]) => {
                await sendDiscordResponse(msg, message, attachments);
            });
        } catch (e) {
            console.error("An error occured while processing a message.", e)
            await msg.reply({
                content: "An error occured while processing your message.\n" + e,
            });
        } finally {
            clearInterval(typing);
        }
    });

    client.login(process.env.DISCORD_TOKEN);
};

run();
export type FunctionResponseCallBack = (toolCalls: {
    agentName: string,
    name: string;
    response: string;
}) => Promise<void>;

type PendingMessage = {
    sharedFiles?: {
        url: string;
        fileName: string;
    }[],
    message: string;
}
//type AgentInvoke = (agent: Agent, callback?: FunctionResponseCallBack) => AsyncGenerator<ToolResponseInfo, AgentResponse, unknown>;
type SendResponse = (message: string, attachments?: string[]) => Promise<void>

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

async function sendDiscordResponseFromCommand(msg: ChatInputCommandInteraction<CacheType>, message: string, attachments?: string[]) {
    const chunks = splitStringInChunks(message);
    for (let i = 0; i < chunks.length; i++) {
        const files = (i === chunks.length - 1) ? (attachments ?? []) : [];
        await msg.editReply({
            content: chunks[i],
            files: files
        });
    }
}