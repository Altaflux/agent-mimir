
const ChatOpenAI = require('@langchain/openai').ChatOpenAI;
const ChatAnthropic = require('@langchain/anthropic').ChatAnthropic;
const ChatGroq = require('@langchain/groq').ChatGroq;
// import { z } from "zod";

const z = require("zod").z;
//import { StructuredTool, tool, Tool } from "@langchain/core/tools";
const tool = require("@langchain/core/tools").tool;
const OpenAIEmbeddings = require('@langchain/openai').OpenAIEmbeddings;

//You can create a free API key at https://serper.dev.
//const Serper = require('@agent-mimir/serper-search').Serper;
//const Calculator = require('langchain/tools/calculator').Calculator;
// const WebBrowserToolKit = require('@agent-mimir/selenium-browser').WebBrowserToolKit;
//const JavascriptCodeRunner = require('@agent-mimir/javascript-code-runner').JavascriptCodeRunner;
//const CodeInterpreterPlugin = require('@agent-mimir/code-interpreter').CodeInterpreterPlugin;

//const CallbackManager = require("@langchain/core/callbacks/manager").CallbackManager;
const ChatGoogleGenerativeAI = require("@langchain/google-genai").ChatGoogleGenerativeAI;

// import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
const SqliteSaver = require("@langchain/langgraph-checkpoint-sqlite").SqliteSaver;

const summaryModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-3.5-turbo-16k',
    // modelName: 'gpt-3.5-turbo-16k',
    // callbacks: summaryCallbackManager
});
const browserModel = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-4o-mini-2024-07-18',
    // callbacks: summaryCallbackManager
});
const taskModel2 = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.9,
    modelName: 'gpt-4',
    //    callbacks: callbackManager
});

const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
});
// const chatModel = new ChatOpenAI({
//     openAIApiKey: process.env.OPENAI_API_KEY,
//     temperature: 0,
//     reasoning: {
//         effort: "none"
//     },
//     //modelName: 'gpt-4o-2024-11-20',
//     modelName: 'gpt-5.2',
//     // maxTokens: 4096,
//     // callbacks: callbackManager
// });
// const chatModel = new ChatGroq({
//   apiKey: process.env.GROQ_API_KEY, // Default value.
//   model: "openai/gpt-oss-120b",
// });

const chatModel = new ChatAnthropic({
    temperature: 0.0,
    //  modelName: "claude-3-5-sonnet-20241022",
    modelName: "claude-sonnet-4-6",
    // In Node.js defaults to process.env.ANTHROPIC_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    maxTokens: 16384,
});

// const chatModel = new ChatGoogleGenerativeAI({
//     model: "gemini-3-pro-preview",

//     //modelName: "gemini-2.0-flash",
// });


module.exports = async function () {


    // const CodeInterpreterPluginFactory = (await import('@agent-mimir/code-interpreter')).CodeInterpreterPluginFactory;
    const McpClientPluginFactory = (await import('@mimir/mcp-client')).McpClientPluginFactory;
    const StdioClientTransport = (await import('@mimir/mcp-client')).StdioClientTransport;
    // const DesktopControlPluginFactory = (await import('@agent-mimir/desktop-control')).DesktopControlPluginFactory;
    // const WebBrowserPluginFactory = (await import('@agent-mimir/playwright-browser')).WebBrowserPluginFactory;

    // const GameboyPluginFactory = (await import('@agent-mimir/gameboy-play')).GameboyPluginFactory;
    // const SqlLiteFactory = (await import('@agent-mimir/sqlite-tool')).SqliteToolPluginFactory;
    //new Foo();
    //  const checkpointer = SqliteSaver.fromConnString("C:\\AI\\mimir\\mydatabase1.db");
    return {
        continuousMode: false,
        workingDirectory: 'C:\\AI\\mimir',
        embeddings: embeddings,
        //   checkpointer: checkpointer,
        agents: {
            'Assistant': {
                mainAgent: true,
                description: 'An assistant',
                definition: {
                    communicationWhitelist: true,
                    chatModel: chatModel,
                    //agentType: "openai-function-agent",
                    agentType: "plain-text-agent",
                    profession: 'an Assistant that instructs and guide workers to do tasks',
                    visionSupport: true,
                    chatHistory: {
                        tokenLimit: 300, //Maximum number of tokens that can be used by the chat. 8000 by default.
                        conversationTokenThreshold: 90, //Percentage threshold of the tokens used by the chat before summarizing. 75% by default.
                        summaryModel: summaryModel

                    },
                    plugins: [
                    ],
                    tools: [

                    ]
                }
            },
            'Researcher1': {
                mainAgent: true,
                description: 'An agent specialized in research.',
                definition: {
                    communicationWhitelist: true,
                    chatModel: chatModel,
                    //agentType: "openai-function-agent",
                    agentType: "plain-text-agent",
                    profession: 'an agent specialized in research',
                    visionSupport: true,
                    chatHistory: {
                        tokenLimit: 300, //Maximum number of tokens that can be used by the chat. 8000 by default.
                        conversationTokenThreshold: 90, //Percentage threshold of the tokens used by the chat before summarizing. 75% by default.
                        summaryModel: summaryModel

                    },
                    plugins: [

                        // new McpClientPluginFactory({

                        //     servers: {

                        //         "researcher": {
                        //             description: "Execute complex research",
                        //             transport: () => new StdioClientTransport({
                        //                 "command": "py",
                        //                 "env": {
                        //                     PYTHONUTF8: "1",
                        //                     PYTHONIOENCODING: "utf-8"
                        //                 },
                        //                 "args": ["C:\\Users\\pablo\\projects\\gptr-mcp\\server.py"]
                        //             })
                        //         },

                        //     }
                        // }),
                    ],
                    tools: [

                    ]
                }
            },
            'Researcher2': {
                mainAgent: true,
                description: 'An agent specialized in research.',
                definition: {
                    communicationWhitelist: true,
                    chatModel: chatModel,
                    //agentType: "openai-function-agent",
                    agentType: "plain-text-agent",
                    profession: 'an agent specialized in research',
                    visionSupport: true,
                    chatHistory: {
                        tokenLimit: 300, //Maximum number of tokens that can be used by the chat. 8000 by default.
                        conversationTokenThreshold: 90, //Percentage threshold of the tokens used by the chat before summarizing. 75% by default.
                        summaryModel: summaryModel

                    },
                    plugins: [

                        new McpClientPluginFactory({

                            servers: {

                                "researcher": {
                                    description: "Execute complex research",
                                    transport: () => new StdioClientTransport({
                                        "command": "py",
                                        "env": {
                                            PYTHONUTF8: "1",
                                            PYTHONIOENCODING: "utf-8"
                                        },
                                        "args": ["C:\\Users\\pablo\\projects\\gptr-mcp\\server.py"]
                                    })
                                },

                            }
                        }),
                    ],
                    tools: [

                    ]
                }
            },

            // 'ScriptRunner': {
            //     mainAgent: false,
            //     description: 'A worker has the ability to modify files such as pictures.',
            //     definition: {
            //         communicationWhitelist: true,
            //         chatModel: chatModel,
            //         summaryModel: summaryModel,
            //         //agentType: "plain-text-agent",
            //         agentType: "openai-function-agent",
            //         profession: 'an Assistant that  has the execute code to modify files thru the code interpreter.',
            //         chatHistory: {
            //             tokenLimit: 2300, //Maximum number of tokens that can be used by the chat. 8000 by default.
            //             conversationTokenThreshold: 50, //Percentage threshold of the tokens used by the chat before summarizing. 75% by default.
            //             //Percentage of messages to summarize
            //         },
            //         plugins: [
            //             new CodeInterpreterPluginFactory(),
            //         ],
            //         tools: [

            //         ]
            //     }
            // },
            // 'NorthwindDBManager': {
            //     mainAgent: false,
            //     description: 'A worker has the ability to query a Northwind sql database.',
            //     definition: {
            //         communicationWhitelist: false,
            //         chatModel: chatModel,
            //         summaryModel: summaryModel,
            //         //agentType: "plain-text-agent",
            //         agentType: "plain-text-agent",
            //         profession: 'an Assistant that has the ability to query a Northwind sql database.',
            //         chatHistory: {
            //             tokenLimit: 2300, //Maximum number of tokens that can be used by the chat. 8000 by default.
            //             conversationTokenThreshold: 50, //Percentage threshold of the tokens used by the chat before summarizing. 75% by default.
            //             //Percentage of messages to summarize
            //         },
            //         plugins: [
            //             new McpClientPluginFactory({
            //                 servers: {
            //                     "sqlite": {
            //                         description: "Query a Northwind SQLite database.",
            //                         transport: new StdioClientTransport({
            //                             "command": "docker",
            //                             "args": ["run", "-i", "--rm", "-v", "C:/AI:/mcp", "mcp/sqlite", "--db-path", "/mcp/northwind.db"]
            //                         })
            //                     },
            //                 }
            //             }),
            //         ],
            //         tools: [

            //         ]
            //     }
            // },
        }
    }
}