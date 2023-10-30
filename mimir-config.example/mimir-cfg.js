
const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;
const OpenAIEmbeddings = require('langchain/embeddings/openai').OpenAIEmbeddings;

const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-4-0613'
});

const summaryModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-3.5-turbo-16k-0613',
});

const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
});

module.exports = async function () {

    const CodeInterpreterPluginFactory = (await import('@agent-mimir/code-interpreter')).CodeInterpreterPluginFactory;
    const WebBrowserPluginFactory = (await import('@agent-mimir/selenium-browser')).WebBrowserPluginFactory;
    
    return {
        continuousMode: false,
        agents: {
            'Assistant': {
                mainAgent: true,
                description: 'An assistant',
                definition: {
                    agentType: 'openai-function-agent',
                    chatModel: chatModel,
                    summaryModel: summaryModel,
                    profession: 'an Assistant',
                    plugins: [
                        new CodeInterpreterPluginFactory(),
                        new WebBrowserPluginFactory({ browserConfig: { browserName: "chrome", disableHeadless: true }, maximumChunkSize: 5000, numberOfRelevantDocuments: 3 }, summaryModel, embeddings)
                    ],
                    tools: [

                    ],
                }
            }
        }
    }
}
