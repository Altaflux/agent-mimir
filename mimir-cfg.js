
const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;
const WebBrowser = require('langchain/tools/webbrowser').WebBrowser;
const OpenAIEmbeddings = require('langchain/embeddings/openai').OpenAIEmbeddings;
const Tool = require('langchain/tools').Tool;
const Serper = require('langchain/tools').Serper;

const exec = require('child_process').exec;
const chalk = require('chalk');
const CallbackManager = require('langchain/callbacks').CallbackManager;
//import { CallbackManager } from "langchain/callbacks";

// /import chalk from 'chalk';

const callbackManager = CallbackManager.fromHandlers({
    handleLLMStart: async (llm, prompts) => {
        console.log(chalk.yellow("####################HELPER INPUT#######################"));
        console.log(prompts[0]);
        console.log(chalk.yellow("###################################################"));
    },
    handleLLMEnd: async (output) => {
        // console.log("#####################AI OUTPUT#######################");
        // // console.log(JSON.stringify(output.generations[0][0].text, null, 2));
        // console.log(output.generations[0][0].text)
        // console.log("#####################################################");
        // console.log("#######################################################################################\n\n");
    },
    handleLLMError: async (err) => {
        console.error(err);
    },
});


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
    modelName: 'gpt-4',
    callbacks: callbackManager
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
                communicationWhitelist: ['MR_CHEF'],
                chatHistory: {
                    maxChatHistoryWindow: 6,
                    maxTaskHistoryWindow: 6,
                },
                tools: [
                    new WebBrowser({
                        model: taskModel,
                        embeddings: embeddings,
                    }),
                    new Serper(),
                    new PowerShell(),
                ],
            },
            'MR_CHEF': {
                mainAgent: true,
                chatModel: chatModel,
                taskModel: taskModel,
                summaryModel: taskModel,
                profession: 'a chef',
                chatHistory: {
                    maxChatHistoryWindow: 6,
                    maxTaskHistoryWindow: 6,
                },
                tools: [
                ],
            }
        }
    }
}