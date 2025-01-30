
import chalk from "chalk";
import { Tool } from "@langchain/core/tools";
import { promises as fs } from 'fs';
import normalFs from 'fs';
import os from 'os';
import path from "path";
import { ChannelType, Client, GatewayIntentBits, Partials, REST, Routes, Events, Message, CacheType, ChatInputCommandInteraction } from 'discord.js';
import { Readable } from "stream";
import { finished } from "stream/promises";
import { SlashCommandBuilder } from "discord.js";
import { FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentInvoke, HandleMessageResult, IntermediateAgentResponse, OrchestratorBuilder } from "agent-mimir/communication/multi-agent";
import { Agent, AgentResponse, ToolResponseInfo } from "agent-mimir/agent";
import { extractAllTextFromComplexResponse } from "agent-mimir/utils/format";
import { PluginFactory } from "agent-mimir/plugins";
import { ComplexMessageContent } from "agent-mimir/schema";
import { LangchainToolWrapperPluginFactory } from "agent-mimir/tools/langchain";

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
        plugins?: PluginFactory[];
        chatHistory: {
            summaryModel: BaseChatModel;
            tokenLimit?: number;
            conversationTokenThreshold?: number;
        }
        langChainTools?: Tool[];
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

    const workspaceFactory = async (agentName: string) => {
        const tempDir = path.join(workingDirectory, agentName);
        await fs.mkdir(tempDir, { recursive: true });
        const workspace = new FileSystemAgentWorkspace(tempDir);
        await fs.mkdir(workspace.workingDirectory, { recursive: true });
        return workspace;
    }
    const orchestratorBuilder = new OrchestratorBuilder();

    const agents = await Promise.all(Object.entries(agentConfig.agents).map(async ([agentName, agentDefinition]) => {
        if (agentDefinition.definition) {
            const newAgent = {
                mainAgent: agentDefinition.mainAgent,
                name: agentName,
                agent: await orchestratorBuilder.createAgent({
                    communicationWhitelist: agentDefinition.definition.communicationWhitelist,
                    name: agentName,
                    description: agentDefinition.description,
                    profession: agentDefinition.definition.profession,
                    model: agentDefinition.definition.chatModel,
                    visionSupport: agentDefinition.definition.visionSupport,
                    constitution: agentDefinition.definition.constitution,
                    plugins: [...agentDefinition.definition.plugins ?? [], ...(agentDefinition.definition.langChainTools ?? []).map(t => new LangchainToolWrapperPluginFactory(t))],
                    workspaceFactory: workspaceFactory,
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

    const chatAgentHandle = orchestratorBuilder.build(mainAgent);

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
                await chatAgentHandle.reset();
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


            const agentInvoke: AgentInvoke = (agent) => agent.handleCommand({
                command: {
                    name: interaction.commandName,
                    arguments: commandArguments
                }
            });

            messageHandler(agentInvoke, async (message, attachments?: string[]) => {
                await sendDiscordResponseFromCommand(interaction, message, attachments);
            })
        }


    });
    const messageHandler = async (msg: AgentInvoke, sendResponse: SendResponse) => {

        let toolCallback: FunctionResponseCallBack = async (call) => {
            const formattedResponse = extractAllTextFromComplexResponse(call.response).substring(0, 3000);
            const toolResponse = `Agent: \`${call.agentName}\`  \n---\nCalled function: \`${call.name}\` \nResponded with: \n\`\`\`${formattedResponse}\`\`\``;
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
                const stringResponse = extractAllTextFromComplexResponse(chainResponse.content.content);
                const discordMessage = `\`${chainResponse.sourceAgent}\` is sending a message to \`${chainResponse.destinationAgent}\`:\n\`\`\`${stringResponse}\`\`\`` +
                    `\nFiles provided: ${chainResponse.content.sharedFiles?.map((f: any) => `\`${f.fileName}\``).join(", ") || "None"}`;
                await sendResponse(discordMessage, chainResponse.content.sharedFiles?.map((f: any) => f.url));
            }
        };

        let result: IteratorResult<IntermediateAgentResponse, HandleMessageResult>;
        const generator = chatAgentHandle.handleMessage(msg)

        while (!(result = await generator.next()).done) {
            intermediateResponseHandler(result.value);
        }

        if (result.value.type === "agentResponse") {
            const stringResponse = extractAllTextFromComplexResponse(result.value.content.content);
            await sendResponse(stringResponse, result.value.content.sharedFiles?.map((f: any) => f.url));
            return
        } else {
            while (result.value.type === "toolRequest") {
                const toolCalls = (result.value.toolCalls ?? []).map(tr => {
                    return `Tool request: \`${tr.toolName}\`\n With Payload: \n\`\`\`${JSON.stringify(tr.input)}\`\`\``;
                }).join("\n");
                const stringResponse = extractAllTextFromComplexResponse(result.value.content);
                const toolResponse = `Agent: \`${result.value.callingAgent}\` \n ${stringResponse} \n---\nCalling functions: ${toolCalls} `;
                await sendResponse(toolResponse, []);
                const generator = chatAgentHandle.handleMessage((agent) => agent.call({
                    message: null,
                    requestAttributes: {}
                }));
                while (!(result = await generator.next()).done) {
                    intermediateResponseHandler(result.value);
                }
            }
            const stringResponse = extractAllTextFromComplexResponse(result.value.content.content);
            await sendResponse(stringResponse, result.value.content.sharedFiles?.map((f: any) => f.url));
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
                //const messageToSend = { message: messageToAi, sharedFiles: loadedFiles };
                const generator = agent.call({
                    message: {
                        content:[
                            {
                                type: "text",
                                text: messageToAi
                            }
                        ],
                        sharedFiles: loadedFiles
                    },
                    requestAttributes: {}
                })

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
    response: ComplexMessageContent[];
}) => Promise<void>;



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