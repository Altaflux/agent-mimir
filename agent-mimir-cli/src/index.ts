import { MimirAgentTypes } from "agent-mimir/agent";
import { AgentManager } from "agent-mimir/agent-manager"
import { MimirPluginFactory, WorkspaceManager } from "agent-mimir/schema";
import chalk from "chalk";
import { BaseChatModel } from 'langchain/chat_models';
import { BaseLanguageModel } from "langchain/base_language";
import { Tool } from "langchain/tools";
import { BaseChain } from "langchain/chains";
import { chatWithAgent } from "./chat.js";
import { promises as fs } from 'fs';
import os from 'os';
import path from "path";
import { AIMessage, BaseMessage, ChatMessage, ChatMessageFieldsWithRole, FunctionMessage, HumanMessage, StoredMessage, SystemMessage } from "langchain/schema";

const messages: StoredMessage[] = [
    { "type": "human", "data": { "content": "Write me a short story.", "additional_kwargs": {}, role: undefined, name: undefined } },
    {
        "type": "ai", "data": {
            role: undefined, name: undefined,
            "content": "- Thoughts: The user has asked me to write a short story. This is a creative task that I can accomplish using my language generation capabilities.\n- Reasoning: As an AI language model, I can generate a short story based on a variety of themes, characters, and settings. I don't need to use any external functions for this task.\n- Plan: [\"Generate a short story\", \"Present the story to the user\"]\n- Current Plan Step: Generate a short story\n- Goal Given By User: Write a short story.",
            "additional_kwargs":
            {
                "function_call":
                {
                    "name": "respondBack",
                    "arguments": "{\n  \"messageToSend\": \"Once upon a time, in a small village nestled between a dense forest and a towering mountain, lived a young girl named Lily. She was known for her vibrant red hair and her insatiable curiosity. Lily was always full of questions, always eager to learn more about the world around her.\\n\\nOne day, while exploring the forest, Lily stumbled upon a hidden path. It was narrow and winding, barely visible beneath the thick foliage. Intrigued, she decided to follow it. The path led her to a clearing where a majestic, ancient tree stood. Its branches reached out towards the sky, and its roots dug deep into the earth.\\n\\nAs Lily approached the tree, she noticed something peculiar. There was a small door at the base of the tree. She knocked, and to her surprise, the door creaked open. Inside, she found a tiny, magical world inhabited by creatures she had only heard of in her grandmother's stories - fairies, elves, and talking animals.\\n\\nLily spent the day in this magical world, learning about their ways and sharing stories about her own world. As the sun began to set, she bid her new friends goodbye and promised to visit again.\\n\\nFrom that day forward, Lily became the bridge between the two worlds. She shared knowledge, stories, and friendship, enriching both worlds and creating a bond that would last for generations.\\n\\nAnd so, the story of Lily, the curious girl from the village, became a legend, a tale of curiosity, bravery, and the magic of friendship.\"\n}"
                }
            }
        }
    },
    { "type": "human", "data": { "content": "That was great, please write me another continuation.", "additional_kwargs": {}, role: undefined, name: undefined } },
    {
        "type": "ai", "data": {
            role: undefined, name: undefined,
            "content": "- Thoughts: The user has asked me to write a short story. This is a creative task that I can accomplish using my language generation capabilities.\n- Reasoning: As an AI language model, I can generate a short story based on a variety of themes, characters, and settings. I don't need to use any external functions for this task.\n- Plan: [\"Generate a short story\", \"Present the story to the user\"]\n- Current Plan Step: Generate a short story\n- Goal Given By User: Write a short story.",
            "additional_kwargs":
            {
                "function_call":
                {
                    "name": "respondBack",

                    "arguments": "{\n  \"messageToSend\": \"But as time went on, the balance between the two worlds began to shift. The creatures of the magical realm started to face problems. A mysterious darkness was spreading, corrupting the creatures and making them forget their true selves. Panicked whispers and hushed conversations echoed through the magical world every time Lily visited.\\r\\n\\r\\nOne evening, as the crimson hues of twilight painted the sky, an old wise owl named Orin approached Lily. \\\"Our world is in peril,\\\" he began, his voice heavy with concern. \\\"The darkness that spreads is not of our making. We believe it stems from a disconnect between our worlds.\\\"\\r\\n\\r\\nLily listened intently, her heart heavy. She realized that as tales of her adventures spread in the village, some greedy men had started searching for the hidden path, seeking the magic and riches they believed the other world held. Their intentions were far from pure, and their negative energies had started seeping into the magical realm.\\r\\n\\r\\nDetermined to restore balance and protect her friends, Lily devised a plan. With the help of the creatures, she decided to move the entrance to their world. Together, they worked tirelessly, and using combined magic, created a new doorway hidden behind a waterfall in the mountains. This entrance would only reveal itself to those with a pure heart and true intentions.\\r\\n\\r\\nTo further strengthen the bond, every year, a chosen few from the village and the magical realm would meet in secret, ensuring that the stories, lessons, and friendship between the worlds remained strong, but also ensuring the safety of the magical world.\\r\\n\\r\\nThe greedy men from the village searched and searched but could never again find the path to the magical realm. As years turned to decades, their tales turned to myths, and soon, they were nothing more than legends whispered by the firelight.\\r\\n\\r\\nLily's efforts not only saved the magical world but also taught the village the importance of respect, trust, and the dangers of greed. Her legacy lived on, and her story became a testament to the power of pure intentions, bravery, and the unbreakable bonds of friendship.\"\n}",
                }
            }
        }
    },
    { "type": "human", "data": { "content": "That was great, please write me another continuation.", "additional_kwargs": {}, role: undefined, name: undefined } },
    {
        "type": "ai", "data": {
            role: undefined, name: undefined,
            "content": "- Thoughts: The user has asked me to write a short story. This is a creative task that I can accomplish using my language generation capabilities.\n- Reasoning: As an AI language model, I can generate a short story based on a variety of themes, characters, and settings. I don't need to use any external functions for this task.\n- Plan: [\"Generate a short story\", \"Present the story to the user\"]\n- Current Plan Step: Generate a short story\n- Goal Given By User: Write a short story.",
            "additional_kwargs":
            {
                "function_call":
                {
                    "name": "respondBack",

                    "arguments": "{\n  \"messageToSend\": \"Years passed, and Lily grew older. Her red hair turned silver, and her steps became slower, but her spirit remained as vibrant as ever. She continued to visit the magical realm, her bond with the creatures unbroken. However, she knew that she wouldn't be able to protect and bridge the two worlds forever.\\r\\n\\r\\nOne day, she noticed a young boy in the village. His name was Finn, and he reminded her of herself. He was curious, kind, and had a heart full of wonder. Lily saw in him the same spirit that had led her to the magical realm all those years ago.     \\r\\n\\r\\nShe decided to pass on her legacy to Finn. She told him about the magical world, the creatures, and the bond that connected their worlds. She taught him about the importance of respect, trust, and the dangers of greed. Finn listened to her stories, his eyes wide with wonder and excitement.\\r\\n\\r\\nWhen the time was right, Lily took Finn to the waterfall in the mountains. She watched as the hidden door revealed itself to Finn, a testament to his pure heart and true intentions. The creatures of the magical realm welcomed Finn, recognizing the same spirit in him that they had seen in Lily.\\r\\n\\r\\nAnd so, the torch was passed. Finn became the new guardian of the two worlds, ensuring their bond remained strong. Lily, content that the worlds were in good hands, finally allowed herself to rest.\\r\\n\\r\\nHer story lived on, passed down from generation to generation. It served as a reminder of the brave girl with red hair who became a bridge between two worlds, a testament to the power of curiosity, bravery, and the magic of friendship.\"\n}",
                }
            }
        }
    },

];

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
export const run = async () => {

    const agentConfig: AgentMimirConfig = await getConfig();

    const agentManager = new AgentManager({
        workspaceManagerFactory: async (agent) => {
            const tempDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-cli-')), "workspace");
            await fs.mkdir(tempDir, { recursive: true });
            return new FileSystemWorkspaceManager(tempDir)!;
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
                    messageHistory: mapStoredMessagesToChatMessages(messages),
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
            throw new Error(`Agent "${agentName}" has no definition`);
        }

    }));

    const mainAgent = agents.length === 1 ? agents[0].agent : agents.find(a => a.mainAgent)?.agent;
    if (!mainAgent) {
        throw new Error("No main agent found");
    }

    console.log(chalk.green(`Using "${mainAgent.name}" as main agent`));
    await chatWithAgent(continousMode, mainAgent);
};

run();




export function mapStoredMessagesToChatMessages(
    messages: StoredMessage[]
  ): BaseMessage[] {
    return messages.map((message) => {
      const storedMessage = (message);
      switch (storedMessage.type) {
        case "human":
          return new HumanMessage(storedMessage.data);
        case "ai":
          return new AIMessage(storedMessage.data);
        case "system":
          return new SystemMessage(storedMessage.data);
        case "function":
          if (storedMessage.data.name === undefined) {
            throw new Error("Name must be defined for function messages");
          }
          return new FunctionMessage(
            storedMessage.data as any,
            storedMessage.data.name
          );
        case "chat": {
          if (storedMessage.data.role === undefined) {
            throw new Error("Role must be defined for chat messages");
          }
          return new ChatMessage(storedMessage.data as ChatMessageFieldsWithRole);
        }
        default:
          throw new Error(`Got unexpected type: ${storedMessage.type}`);
      }
    });
  }
  