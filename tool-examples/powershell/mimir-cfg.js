
const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;
const Tool = require('langchain/tools').Tool;
const exec = require('child_process').exec;


class PowerShell extends Tool {
    async _call(arg) {
        return new Promise((resolve, reject) => {
            exec(arg, { 'shell': 'powershell.exe' }, (error, stdout, stderr) => {
                if (error) {
                    resolve(error.message)
                }
                else if (stderr) {
                    resolve(stdout)
                } else {

                    resolve(stdout)
                }
            })
        });
    }
    name = "windowsPowershell";
    description = "Run a Powershell command in the human's Powershell terminal. The input must be the command to execute.";
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
                        new PowerShell()
                    ]
                }
            }
        }
    }
}