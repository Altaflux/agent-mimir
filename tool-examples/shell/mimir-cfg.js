
const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;
const Tool = require('langchain/tools').Tool;
const exec = require('child_process').exec;


class Shell extends Tool {
    async _call(arg) {
        return new Promise((resolve, reject) => {
            exec(arg, (error, stdout, stderr) => {
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
    name = "linuxShell";
    description = "Run a shell command in the human's terminal. The input must be the command to execute.";
    constructor() {
        super()
    }
}

const taskModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.9,
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
                    summaryModel: taskModel,
                    profession: 'an Assistant',
                    tools: [ 
                        new Shell()
                    ]
                }
            }
        }
    }
}