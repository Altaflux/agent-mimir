
const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;
const Tool = require('langchain/tools').Tool;
var safeEval = require('safe-eval');

class JavascriptRepl extends Tool {
    
    async _call(arg) {
        return JSON.stringify(safeEval(arg));
    }
    name = "javascriptRepl";
    description = "Run a Javascript snippet of code and get the result back. The input must be the Javascript code to execute.";
    constructor() {
        super()
    }
}

const taskModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.9,
});

const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.9,
    modelName: 'gpt-4',
    callbacks: callbackManager
});


module.exports = function () {
    return {
        continuousMode: false,
        agents: {
            'Assistant': { 
                mainAgent: true, 
                description: 'An assistant', 
                definition: {
                    chatModel: chatModel,
                    summaryModel: taskModel,
                    profession: 'an Assistant',
                    tools: [ 
                        new JavascriptRepl()
                    ]
                }
            }
        }
    }
}