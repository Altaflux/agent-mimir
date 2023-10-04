import { ChatOpenAI } from 'langchain/chat_models/openai';

const openAIModelType = process.env.AGENT_OPENAI_MODEL ?? 'gpt-4-0613';
const agentType = openAIModelType.includes('0613') ? 'openai-function-agent' : 'plain-text-agent';
const taskModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: !isNaN(Number(process.env.AGENT_OPENAI_TASK_TEMPERATURE)) ? Number(process.env.AGENT_OPENAI_TASK_TEMPERATURE) : 0.0,
});

const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: !isNaN(Number(process.env.AGENT_OPENAI_CHAT_TEMPERATURE)) ? Number(process.env.AGENT_OPENAI_CHAT_TEMPERATURE) : 0.0,
    modelName: process.env.AGENT_OPENAI_MODEL 
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
                    taskModel: taskModel,
                    summaryModel: taskModel,
                    profession: 'an Assistant',
                    chatHistory: {
                        maxChatHistoryWindow: 4,
                        maxTaskHistoryWindow: 4,
                    },
                    tools: [
                    ],
                }
            }
        }
    }
}