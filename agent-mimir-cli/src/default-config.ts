import { MimirAgentTypes } from 'agent-mimir/agent';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';


const openAIModelType = process.env.AGENT_OPENAI_MODEL ?? 'gpt-4-0613';
const agentType: MimirAgentTypes = openAIModelType.includes('0613') ? 'openai-function-agent' : 'plain-text-agent';

const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
});

const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: !isNaN(Number(process.env.AGENT_OPENAI_CHAT_TEMPERATURE)) ? Number(process.env.AGENT_OPENAI_CHAT_TEMPERATURE) : 0.0,
    modelName: process.env.AGENT_OPENAI_MODEL
});

const summaryModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-3.5-turbo-16k-0613',
});

// eslint-disable-next-line import/no-anonymous-default-export
export default async function () {
    const plugins = [];
    if (process.env.CODE_INTERPRETER_PLUGIN === 'true') {
        const CodeInterpreterPluginFactory = (await import('@agent-mimir/code-interpreter')).CodeInterpreterPluginFactory;
        plugins.push(new CodeInterpreterPluginFactory());
    }

    if (process.env.WEB_BROWSER_PLUGIN === 'true') {
        const WebBrowserPluginFactory = (await import('@agent-mimir/selenium-browser')).WebBrowserPluginFactory;
        plugins.push(new WebBrowserPluginFactory({ browserConfig: { browserName: "chrome", disableHeadless: true }, maximumChunkSize: 6000, numberOfRelevantDocuments: 3 }, summaryModel, embeddings));
    }

    return {
        continuousMode: false,
        agents: {
            'Assistant': {
                mainAgent: true,
                description: 'An assistant',
                definition: {
                    agentType: agentType,
                    chatModel: chatModel,
                    profession: 'an Assistant',
                    chatHistory: {
                        summaryModel: summaryModel,
                        tokenLimit: 4000,
                        conversationTokenThreshold: 75,
                    },
                    tools: [
                    ],
                    plugins: [
                        ...plugins,
                    ]
                }
            }
        }
    }
}