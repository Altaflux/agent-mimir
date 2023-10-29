
const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;

const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-4-0613'
});

const summaryModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-3.5-turbo-16k-0613',
});

module.exports = async function () {

    const CodeInterpreterPluginFactory = (await import('@agent-mimir/code-interpreter')).CodeInterpreterPluginFactory;

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
                        new CodeInterpreterPluginFactory()
                    ],
                }
            }
        }
    }
}
