
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

const summaryModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.9,
    modelName: 'gpt-3.5-turbo-16k-0613',
});

const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
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
                    chatHistory: {
                        summaryModel: summaryModel
                    },
                    profession: 'an Assistant',
                    tools: [ 
                        new JavascriptRepl()
                    ]
                }
            }
        }
    }
}