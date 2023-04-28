
import { ChatOpenAI } from "langchain/chat_models/openai";
import { CallbackManager } from "langchain/callbacks";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { chatWithAssistant } from "./chat.js";
import { AgentManager } from "agent-mimir";
import chalk from "chalk";
import { createTools } from "./tools.js";

const callbackManager = CallbackManager.fromHandlers({
    handleLLMStart: async (llm: { name: string }, prompts: string[]) => {
        console.log(chalk.yellow("####################HELPER INPUT#######################"));
        console.log(prompts[0]);
        console.log(chalk.yellow("###################################################"));
    },
    handleLLMEnd: async () => {
    },
    handleLLMError: async (err: Error) => {
        console.log(chalk.red("####################HELPER ERROR#######################"));
        console.log(err);
        console.log(chalk.red("###################################################"));
    },
});


export const run = async () => {

    const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.AGENT_OPENAI_API_KEY });
    const callBack = process.env.ENABLE_DEBUG ? callbackManager : undefined;
   
    const agentModelName = process.env.AGENT_MODEL ?? "gpt-3.5-turbo";
    const chatModel = new ChatOpenAI({ temperature: 0.8, openAIApiKey: process.env.AGENT_OPENAI_API_KEY, modelName: agentModelName, callbacks: callBack });
    const taskModel = new ChatOpenAI({ temperature: 0.8, openAIApiKey: process.env.AGENT_OPENAI_API_KEY });

    const tools  = createTools(embeddings, taskModel);
   

    const helpers = new AgentManager();

    const assistant = await helpers.addHelper({
        name: "Assistant",
        profession: "an assistant",
        tools: tools,
        model: chatModel,
        summaryModel: taskModel,
        thinkingModel: taskModel,
    });

    console.log("Created main agent::" + assistant.name);
    await chatWithAssistant(assistant);
};

run();