
const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;
const WebBrowser = require('langchain/tools/webbrowser').WebBrowser;
const OpenAIEmbeddings = require('langchain/embeddings/openai').OpenAIEmbeddings;
const Serper = require('langchain/tools').Serper;

const taskModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.9,
});
const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
});
const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.9,
    modelName: 'gpt-4'
});


module.exports = function() {
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
                    maxChatHistoryWindow: 6,
                    maxTaskHistoryWindow: 6,
                },
                tools: [
                    new WebBrowser({
                        model: taskModel,
                        embeddings: embeddings,
                    }),
                    new Serper()
                ],
            }
        }
    }
}