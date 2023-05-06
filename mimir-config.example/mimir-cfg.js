
const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;
const SeleniumWebBrowser = require('@agent-mimir/selenium-browser').SeleniumWebBrowser;
const OpenAIEmbeddings = require('langchain/embeddings/openai').OpenAIEmbeddings;

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


module.exports = async function() {
    return {
        continuousMode: false,
        agents: {
            'Assistant': { 
                mainAgent: true, 
                description: 'An assistant', 
                definition: {
                    chatModel: chatModel,
                    taskModel: taskModel,
                    summaryModel: taskModel,
                    profession: 'an Assistant',
                    tools: [ 
                        new SeleniumWebBrowser({
                            model: taskModel,
                            embeddings: embeddings,
                            seleniumDriverOptions: {
                                browserName: "chrome"
                            }
                        })
                    ]
                }
            }
        }
    }
}