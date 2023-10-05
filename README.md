# <img src="assets/mimir_logo.svg" width="80" height="80"> Agent Mimir

Agent Mimir is a command line chat client and "agent" manager for LLM's like Chat-GPT that provides the models with access to tooling and a framework with which accomplish multi-step tasks.

It is very easy to configure your own agent with a custom personality or profession as well as enabling access to all tools that are compatible with LangchainJS. https://js.langchain.com/docs/modules/agents/tools/integrations/.

Agent Mimir is based on [LangchainJS](https://github.com/hwchase17/langchainjs), every tool or LLM that works on Langchain should also work with Mimir. The prompts are currently tuned on GPT-4 and GPT-3.5 but other models might work.

The tasking system is based on Auto-GPT and BabyAGI where the agent needs to come up with a plan, iterate over its steps and review as it completes the task.

<h2 align="center">Demo</h2>
<p align="center">
    <img align="center" src="assets/demo-screenshot.png" width="800" height="500">
</p>

## Usage

### Requirements
You must have installed NodeJS version 18 or above.

### Installation

1. Clone this repository `git clone https://github.com/Altaflux/agent-mimir`
2. Install the required packages `npm install`
3. Copy the .env.example file to .env: cp .env.example .env.
4. In the .env file set the your OpenAI key in `AGENT_OPENAI_API_KEY` and in `AGENT_OPENAI_MODEL` the model you want to use.
5. Optionally, create a custom configuration file to use a custom agent.


### How to use
To start the chat run the command `npm run start`
It is important to tell the agent every time it has completed a task the phrase `task complete`. This will erease its task's memory. This is useful to keep the number of tokens small.

## Customizing Agents Configuration

By default Mimir will create an agent with no tools and Chat GPT-4. You can configure a custom agent by creating a directory called `mimir-config` with the configuration file `mimir-cfg.js`, use `mimir-config.example` as a reference. By configuring an agent you can change its language model to any other model supported by LangchainJS

```javascript

const ChatOpenAI = require('langchain/chat_models/openai').ChatOpenAI;
const OpenAIEmbeddings = require('langchain/embeddings/openai').OpenAIEmbeddings;

//Configure your language models, tools and embeddings
const summaryModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-3.5-turbo-16k-0613',
});
const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
});
const chatModel = new ChatOpenAI({
    openAIApiKey: process.env.AGENT_OPENAI_API_KEY,
    temperature: 0.0,
    modelName: 'gpt-4-0613'
});


module.exports = async function() {
    
    //Plugins and tools can be loaded as follows:
    const Serper = (await import('@agent-mimir/serper-search')).Serper;
    const WebBrowserToolKit = (await import('@agent-mimir/selenium-browser')).WebBrowserToolKit;
    const CodeInterpreterPlugin = (await import('@agent-mimir/code-interpreter')).CodeInterpreterPlugin;
    const webToolKit = new WebBrowserToolKit({ browserConfig: { browserName: "chrome" } }, taskModel, embeddings);

    return {
        //If continuousMode is set to true the agent will not ask you before executing a tool. Disable at your own risk.
        continuousMode: false,
        agents: {
            'Assistant': { //The name of the agent
                mainAgent: true, //When using multiple agents, set one agent as the mainAgent for the chat.
                description: 'An assistant', //A description of the agent and how to talk to it.
                definition: {
                    chatModel: chatModel, //The main chat LLM used for conversation and memory.
                    agentType: 'openai-function-agent', //Use "plain-text-agent" for general LLM, you can use "openai-function-agent" if your chat model is gpt-4-0613 or gpt-3.5-turbo-0613 for improved reliability. 
                    summaryModel: summaryModel, //The model used when summarizing conversations.
                    profession: 'an Assistant', //The profession assigned to the agent.
                    communicationWhitelist: ['MR_CHEF'], //The list of agents it is allowed to talk to.
                    chatHistory: {
                        maxChatHistoryWindow: 6, //Maximum size of the conversational chat before summarizing. 4 by default
                        maxTaskHistoryWindow: 6, //Maximum size of the task chat before summarizing. 4 by default
                    },
                    plugins: [
                            new CodeInterpreterPlugin({
                                inputDirectory: "C:\\AI\\interpreter\\in",
                                outputDirectory: "C:\\AI\\interpreter\\out"
                            }),
                    ],
                    tools: [ //Tools available to the agent.
                        ...webToolKit.tools,
                        new Serper(process.env.SERPER_API_KEY)
                    ]
                }
            }
        }
    }
}
```
## Additional Node Dependencies

If you would like to add additional nodejs dependencies to the project to use custom tools or LLMs you can create a `package.json` file inside the `mimir-config` directory. When Mimir starts it will install the dependencies automatically and make them available for your `mimir-cfg.js` configuration.
```json
{
    "name": "agent-mimir-deps",
    "private": false,
    "scripts": {},
    "dependencies": {
        "my-tool": "1.3.0"
    }
}

```

## Useful tools:

Take a look at LangchainJS documentation for how to use their tools: https://js.langchain.com/docs/modules/agents/tools/

Here is a list of useful and easy to install tools you can try:

### Code Interpreter Plugin:
The Code Interpreter plugin allows the agent to run Python 3 scripts directly in your machine. The interpreter can access resources inside your computer. The interpreter will automatically install any dependencies the script requires to run.

You can optionally configure an input and output directory that the agent can use to receive files that need processing as well as output files back to the user.

`package.json`
```json
{
    "name": "agent-mimir-deps",
    "private": false,
    "scripts": {},
    "dependencies": {
        "@agent-mimir/code-interpreter": "*"
    }
}
```
`mimir-cfg.js`
```javascript

    const model = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: 0.0,
    });
    const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
    });

    module.exports = async function() {
        const CodeInterpreterPlugin = (await import('@agent-mimir/code-interpreter')).CodeInterpreterPlugin;
        //...
        //Add to plugins:
        plugins: [
                new CodeInterpreterPlugin({
                    inputDirectory: "C:\\AI\\interpreter\\in",
                    outputDirectory: "C:\\AI\\interpreter\\out"
                }),
            ],
    }
```

### Web Browser Toolset:
The Web Browser plugin allows the agent to fully navigate thru any website, giving it the ability to read and interact with the website.

`package.json`
```json
{
    "name": "agent-mimir-deps",
    "private": false,
    "scripts": {},
    "dependencies": {
        "@agent-mimir/selenium-browser": "*"
    }
}
```
`mimir-cfg.js`
```javascript
    
    const model = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: 0.0,
    });
    const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
    });

    module.exports = async function() {
        const WebBrowserToolKit = (await import('@agent-mimir/selenium-browser')).WebBrowserToolKit;
        const webToolKit = new WebBrowserToolKit({ browserConfig: { browserName: "chrome" } }, model, embeddings);
        //...
        tools: [
                ...webToolKit.tools,
            ],
    }
```

### Search Plugin:

`mimir-cfg.js`
```javascript
    module.exports = async function() {
        const Serper = (await import('@agent-mimir/serper-search')).Serper;
        //...
        tools: [
                new Serper(process.env.SERPER_API_KEY) // https://serper.dev.
            ],
    }
```

### Calculator Plugin:

`mimir-cfg.js`
```javascript
    module.exports = async function() {
        const Calculator = (await import('langchain/tools/calculator')).Calculator;
        //...
        tools: [
                new Calculator()
            ],
    }
```

Take a look at the `tool-examples` directory  for other tools.

## Agent communication
If you declare multiple agents in your configuration you can enable communication with each other. The agent may try to establish communication with another agent if it thinks it will help him complete a task.

You can enable communication be setting `canCommunicateWithAgents` to either `true` if you want the agent to be able to communicate with every other agent or pass an array of the names of the agents it is allowed to talk to (`['Mr_Chef', 'Artist']`).

Note: Even if continuous mode is set to false if an agent who is being talked to tries to use a tool it will not ask the user first. I need to rework how continuous mode is implemented.

## Roadmap

* Configurable memory types to allow persistent memory or different use cases.
* Different prompts for different LLMs to improve compatibility.
* Talk to multiple agents simultaneously.
* Provide access to the chat in different forms like web or text to speech.