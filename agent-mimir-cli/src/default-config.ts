import { ChatOpenAI } from 'langchain/chat_models/openai';

const taskModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.9,
});

const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.9,
    modelName: process.env.AGENT_OPENAI_MODEL 
});


export default function () {
    return {
        continuousMode: false,
        agents: {
            'Assistant': {
                mainAgent: true,
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