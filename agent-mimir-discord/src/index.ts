
import chalk from "chalk";
import { StructuredTool } from "@langchain/core/tools";
import { promises as fs } from 'fs';
import normalFs from 'fs';
import os from 'os';
import path from "path";
import { ChannelType, Client, GatewayIntentBits, Partials, REST, Routes, Events, Message, CacheType, ChatInputCommandInteraction, ButtonInteraction, BaseMessageOptions, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { Readable } from "stream";
import { finished } from "stream/promises";
import { SlashCommandBuilder } from "discord.js";
import { FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentToolRequestTwo, HandleMessageResult, IntermediateAgentResponse, OrchestratorBuilder, MultiAgentCommunicationOrchestrator } from "agent-mimir/communication/multi-agent";
import { extractAllTextFromComplexResponse } from "agent-mimir/utils/format";
import { PluginFactory } from "agent-mimir/plugins";
import { ComplexMessageContent, ImageMessageContent } from "agent-mimir/schema";
import { LangchainToolWrapperPluginFactory } from "agent-mimir/tools/langchain";
import { file } from 'tmp-promise';
import { CodeAgentFactory, LocalPythonExecutor } from "agent-mimir/agent/code-agent";
import { FunctionAgentFactory } from "agent-mimir/agent/tool-agent";
import { BaseCheckpointSaver } from "@langchain/langgraph";
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
        checkpointer?: BaseCheckpointSaver,
        chatHistory: {
            summaryModel: BaseChatModel;
            tokenLimit?: number;
            conversationTokenThreshold?: number;
        }
        langChainTools?: StructuredTool[];
        communicationWhitelist?: string[] | boolean;
    },

}
type AgentMimirConfig = {
    agents: Record<string, AgentDefinition>;
    embeddings: Embeddings;
    continuousMode?: boolean;
    workingDirectory?: string;
}
export type AgentInvoke = (args: MultiAgentCommunicationOrchestrator,) => AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void>;
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
                agent: await orchestratorBuilder.initializeAgent(new CodeAgentFactory({
                    description: agentDefinition.description,
                    profession: agentDefinition.definition.profession,
                    model: agentDefinition.definition.chatModel,
                    checkpointer: agentDefinition.definition.checkpointer,
                    visionSupport: agentDefinition.definition.visionSupport,
                    constitution: agentDefinition.definition.constitution,
                    plugins: [...agentDefinition.definition.plugins ?? [], ...(agentDefinition.definition.langChainTools ?? []).map(t => new LangchainToolWrapperPluginFactory(t))],
                    workspaceFactory: workspaceFactory,
                    codeExecutor: new LocalPythonExecutor({additionalPackages: ["pandas", "numpy"]}),
                }), agentName, agentDefinition.definition.communicationWhitelist)
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
    const continuousModeToggleCommand = new SlashCommandBuilder().setName('continuous-mode')
        .setDescription('Toggles the continuous mode of the agent.');

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

    const commands = [continuousModeToggleCommand, resetCommand, ...agentCommands];


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

        if (interaction.isButton()) {
            if (interaction.customId === 'continue') {
                await interaction.deferReply();
                await interaction.followUp({
                    content: 'Continuing the conversation...',
                });

                const agentInvoke: AgentInvoke = (agent) => agent.handleMessage({
                    message: null
                }, interaction.channelId);
                messageHandler(agentInvoke, async (message) => {
                    await sendDiscordResponseFromCommand(interaction, message.message, message.attachments, message.images, message.embeds, message.components);
                }, interaction.channelId)
            }
            return;
        };


        if (!interaction.isChatInputCommand()) return;
        await interaction.deferReply();
        if (interaction.commandName === 'continuous-mode') {
            agentConfig.continuousMode = !agentConfig.continuousMode;
            await interaction.editReply(`Continuous mode is now ${agentConfig.continuousMode ? 'enabled' : 'disabled'}.`);
        }

        if (interaction.commandName === 'reset') {
            try {
                await chatAgentHandle.reset({ threadId: interaction.channelId });
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
            }, interaction.channelId);

            messageHandler(agentInvoke, async (message) => {
                await sendDiscordResponseFromCommand(interaction, message.message, message.attachments, message.images, message.embeds, message.components);
            }, interaction.channelId)
        }


    });
    const messageHandler = async (msg: AgentInvoke, sendResponse: SendResponse, threadId: string) => {

        let toolCallback: FunctionResponseCallBack = async (call) => {
            const formattedResponse = extractAllTextFromComplexResponse(call.response).substring(0, 3000);
            const toolResponse = `Agent: \`${call.agentName}\``;
            const images = await imagesToFiles(call.response);

            const headerEmbed = new EmbedBuilder()
                .setDescription(`Called function: \`${call.name}\` \nResponded with: \n\`\`\`${formattedResponse}\n${images.map(i=>"(image)")}\`\`\``)
                .setColor(0xff0000);
            await sendResponse({
                message: toolResponse,
                embeds: [headerEmbed],
                images: images
            });
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
                await sendResponse({
                    message: discordMessage,
                    attachments: chainResponse.content.sharedFiles?.map((f: any) => f.url)
                });
            }
        };

        let result: IteratorResult<IntermediateAgentResponse, HandleMessageResult>;
        const generator = msg(chatAgentHandle)

        while (!(result = await generator.next()).done) {
            intermediateResponseHandler(result.value);
        }

        const sendToolInvocationPermissionRequest = async (toolRequest: AgentToolRequestTwo) => {
            const toolCalls = (toolRequest.toolCalls ?? []).map(tr => {
                const headerEmbed = new EmbedBuilder()
                    .setDescription(`Tool request: \`${tr.toolName}\`\nWith Payload: \n\`\`\`${tr.input}\`\`\``)
                    .setColor(0xff0000);
                return headerEmbed;
            });
            const stringResponse = extractAllTextFromComplexResponse(toolRequest.content);
            const toolResponse = `Agent: \`${toolRequest.callingAgent}\` \n ${stringResponse}`;
            const button = new ButtonBuilder()
                .setCustomId('continue')    // Unique ID for the button
                .setLabel('Continue?')       // Text that appears on the button
                .setStyle(ButtonStyle.Primary);
            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(button);

            await sendResponse({
                message: `${toolResponse}`,
                embeds: [...toolCalls],
                components: [row]
            });
        }

        if (result.value.type === "agentResponse") {
            const stringResponse = extractAllTextFromComplexResponse(result.value.content.content);
            await sendResponse({
                message: stringResponse,
                attachments: result.value.content.sharedFiles?.map((f: any) => f.url)
            });
            return
        } else {

            if (agentConfig.continuousMode) {
                while (result.value.type === "toolRequest" && agentConfig.continuousMode) {
                    const toolCalls = (result.value.toolCalls ?? []).map(tr => {
                        const headerEmbed = new EmbedBuilder()
                            .setDescription(`Tool request: \`${tr.toolName}\`\nWith Payload: \n\`\`\`${tr.input}\`\`\``)
                            .setColor(0xff0000);
                        return headerEmbed;
                    });
                    const stringResponse = extractAllTextFromComplexResponse(result.value.content);
                    const toolResponse = `Agent: \`${result.value.callingAgent}\` \n ${stringResponse}`;


                    await sendResponse({
                        message: toolResponse,
                        embeds: [...toolCalls]
                    });

                    const generator = chatAgentHandle.handleMessage({
                        message: null
                    }, threadId);
                    while (!(result = await generator.next()).done) {
                        intermediateResponseHandler(result.value);
                    }
                }
                if (result.value.type === "agentResponse") {
                    const stringResponse = extractAllTextFromComplexResponse(result.value.content.content);
                    await sendResponse({
                        message: stringResponse,
                        attachments: result.value.content.sharedFiles?.map((f: any) => f.url)
                    });
                    return;
                } else {
                    sendToolInvocationPermissionRequest(result.value);
                    return;
                }

            } else {
                sendToolInvocationPermissionRequest(result.value);
                return;
            }
        }
    }
    client.on(Events.MessageCreate, async msg => {
        const typing = setInterval(() => msg.channel.sendTyping(), 5000);
        try {

            const agentInvoke: AgentInvoke = async function* (agent: MultiAgentCommunicationOrchestrator) {
                const messageToAi = msg.cleanContent.replaceAll(`@${client.user!.username}`, "").trim();
                const loadedFiles = await Promise.all(msg.attachments.map(async (attachment) => {
                    const response = await downloadFile(attachment.name, attachment.url);
                    return {
                        fileName: attachment.name,
                        url: response
                    }
                }));
                return yield* agent.handleMessage({
                    message: {
                        content: [
                            {
                                type: "text",
                                text: messageToAi
                            }
                        ],
                        sharedFiles: loadedFiles
                    }
                }, msg.channelId)
            }

            if (msg.author.bot) return;

            if (msg.channel.type !== ChannelType.DM && !msg.mentions.has(client.user!)) {
                return;
            }
            messageHandler(agentInvoke, async (args) => {
                await sendDiscordResponse(msg, args.message, args.attachments, args.images, args.embeds, args.components);
            }, msg.channelId);
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



type SendResponse = (args: {
    message: string, attachments?: string[], images?: string[],
    embeds?: BaseMessageOptions["embeds"],
    components?: BaseMessageOptions["components"]
}) => Promise<void>

async function sendDiscordResponse(msg: Message<boolean>, message: string, attachments?: string[], images?: string[], embeds?: BaseMessageOptions["embeds"], components?: BaseMessageOptions["components"]) {
    const chunks = splitStringInChunks(message);
    for (let i = 0; i < chunks.length; i++) {
        const files = (i === chunks.length - 1) ? (attachments ?? []) : [];
        const imageFiles = (i === chunks.length - 1) ? (images ?? []) : [];
        const toolEmbeds = (i === chunks.length - 1) ? (embeds ?? []) : [];
        await msg.reply({
            embeds: toolEmbeds,
            content: chunks[i],
            files: [...files, ...imageFiles],
            components: components

        });
    }
}

async function sendDiscordResponseFromCommand(msg: ChatInputCommandInteraction<CacheType> | ButtonInteraction<CacheType>,
    message: string,
    attachments?: string[],
    images?: string[],
    embeds?: BaseMessageOptions["embeds"],
    components?: BaseMessageOptions["components"]
) {
    const chunks = splitStringInChunks(message);
    for (let i = 0; i < chunks.length; i++) {
        const files = (i === chunks.length - 1) ? (attachments ?? []) : [];
        const imageFiles = (i === chunks.length - 1) ? (images ?? []) : [];
        const toolEmbeds = (i === chunks.length - 1) ? (embeds ?? []) : [];
        await msg.followUp({
            embeds: toolEmbeds,
            content: chunks[i],
            files: [...files, ...imageFiles],
            components: components
        });
    }
}

async function imagesToFiles(images: ComplexMessageContent[]): Promise<string[]> {


    const imageUlrs = images.filter(i => i.type === "image_url").map(i => (i as ImageMessageContent).image_url);
    const imagesPath = await Promise.all(imageUlrs.map(async (image) => { return await saveImageFromDataUrl(image.url); }));
    return imagesPath;
}

async function saveImageFromDataUrl(dataUrl: string): Promise<string> {
    const regex = /^data:image\/(png|jpeg);base64,(.+)$/;
    const matches = dataUrl.match(regex);

    if (!matches) {
        throw new Error('Invalid image data URL.');
    }

    const [, imageType, base64Data] = matches;

    const imageBuffer = Buffer.from(base64Data, 'base64');

    const { fd, path, cleanup } = await file({ postfix: `.${imageType}` });

    await fs.writeFile(path, imageBuffer);

    console.log(`Image saved to ${path}`);
    return path;
}
