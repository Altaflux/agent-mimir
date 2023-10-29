import { MimirAgentTypes } from 'agent-mimir/agent';
import { ChatOpenAI } from 'langchain/chat_models/openai';

const openAIModelType = process.env.AGENT_OPENAI_MODEL ?? 'gpt-4-0613';
const agentType: MimirAgentTypes = openAIModelType.includes('0613') ? 'openai-function-agent' : 'plain-text-agent';

const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: !isNaN(Number(process.env.AGENT_OPENAI_CHAT_TEMPERATURE)) ? Number(process.env.AGENT_OPENAI_CHAT_TEMPERATURE) : 0.0,
    modelName: process.env.AGENT_OPENAI_MODEL
});

const summaryModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-3.5-turbo-16k-0613',
});

// eslint-disable-next-line import/no-anonymous-default-export
export default async function () {
    const CodeInterpreterPluginFactory = (await import('@agent-mimir/code-interpreter')).CodeInterpreterPluginFactory;

    return {
        continuousMode: false,
        agents: {
            'Assistant': {
                mainAgent: true,
                description: 'An assistant',
                definition: {
                    agentType: agentType,
                    chatModel: chatModel,
                    summaryModel: summaryModel,
                    profession: 'an Assistant',
                    chatHistory: {
                        tokenLimit: 4000,
                        conversationTokenThreshold: 75,
                    },
                    tools: [
                    ],
                    plugins: [
                        new CodeInterpreterPluginFactory(),
                    ]
                }
            }
        }
    }
}