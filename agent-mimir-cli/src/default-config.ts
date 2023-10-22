import { ChatOpenAI } from 'langchain/chat_models/openai';

const openAIModelType = process.env.AGENT_OPENAI_MODEL ?? 'gpt-4-0613';
const agentType = openAIModelType.includes('0613') ? 'openai-function-agent' : 'plain-text-agent';

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

export default function () {
    return {
        continuousMode: false,
        agents: {
            'Assistant': {
                mainAgent: true,
                description: 'An assistant',
                agentType: agentType,
                definition: {
                    chatModel: chatModel,
                    summaryModel: summaryModel,
                    profession: 'an Assistant',
                    chatHistory: {
                        tokenLimit: 4000,
                        conversationTokenThreshold: 75,
                    }
                }
            }
        }
    }
}