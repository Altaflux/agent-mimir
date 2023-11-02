import { AgentActionOutputParser, BaseSingleActionAgent, StoppingMethod } from "langchain/agents";
import { CallbackManager } from "langchain/callbacks";
import { AgentAction, AgentFinish, AgentStep, BaseMessage, ChainValues } from "langchain/schema";
import { BaseChatMemory, getInputValue } from "langchain/memory";
import { ChatPromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { TrimmingMemory } from "./../memory/trimming-memory/index.js";
import { LLMChain } from "langchain/chains";
import { BaseLLMOutputParser, BaseOutputParser } from "langchain/schema/output_parser";
import { BaseLanguageModel } from "langchain/base_language";
import { HumanMessage } from "langchain/schema";
import { AgentContext, AgentUserMessage, MimirHumanReplyMessage, NextMessage } from "../schema.js";


const BAD_MESSAGE_TEXT = `I could not understand your response, please rememeber to use the correct response format using the appropiate functions. If you need to tell me something, please use the "respondBack" function.`;

export type MimirChatConversationalAgentInput = {
    llmChain: LLMChain<MimirAIMessage>;
    outputParser: AgentActionOutputParser | undefined;
};


export type InternalAgentPlugin = {
    getInputs: (context: AgentContext) => Promise<Record<string, any>>,
    readResponse: (context: AgentContext, aiMessage: MimirAIMessage) => Promise<void>,
    clear: () => Promise<void>,
    processMessage: (nextMessage: NextMessage, inputs: ChainValues) => Promise<NextMessage | undefined>
}

export type MimirAIMessage = {
    functionCall?: {
        name: string,
        arguments: string
    },
    text?: string,
    error?: boolean,
}

export class MimirAgent extends BaseSingleActionAgent {

    outputParser: BaseOutputParser<AgentAction | AgentFinish>;
    taskCompleteCommandName: string
    memory: BaseChatMemory;
    lc_namespace: string[] = [];
    llmChain: LLMChain<MimirAIMessage>;
    defaultInputs?: Record<string, any>;
    plugins: InternalAgentPlugin[];
    name: string;
    
    reset: () => Promise<void>;
    messageGenerator: (arg: NextMessage) => Promise<{ message: BaseMessage, messageToSave: MimirHumanReplyMessage, }>;

    constructor(
        memory: BaseChatMemory,
        taskCompleteCommandName: string,
        input: MimirChatConversationalAgentInput,
        outputParser: BaseOutputParser<AgentAction | AgentFinish>,
        messageGenerator: (arg: NextMessage) => Promise<{ message: BaseMessage, messageToSave: MimirHumanReplyMessage, }>,
        name: string,
   
        reset: () => Promise<void>,
        plugins?: InternalAgentPlugin[],
        defaultInputs?: Record<string, any>,

    ) {
        super(input);
        this.llmChain = input.llmChain;
        this.taskCompleteCommandName = taskCompleteCommandName;
        this.outputParser = outputParser;
        this.memory = memory;
        this.messageGenerator = messageGenerator;
        this.defaultInputs = defaultInputs;
        this.plugins = plugins ?? [];
        this.name = name;
    
        this.reset = reset;
    }

    get inputKeys(): string[] {
        return this.llmChain.inputKeys;
    }

    async prepareForOutput(
        _returnValues: AgentFinish["returnValues"],
        _steps: AgentStep[]
    ): Promise<AgentFinish["returnValues"]> {

        if (_returnValues.complete) {
            await this.reset();
            //NOTE Output has to be of type AgentUserMessage.
            //TODO This function is aware of the input of the FinalTool, it should not be.
            return {
                complete: true,
                output: JSON.stringify({
                    message: _returnValues.output.messageToSend,
                    sharedFiles: [],
                } as AgentUserMessage),
            }
        }
        return {
            complete: false,
            output: _returnValues.output,
        };
    }

    async plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager,
    ): Promise<AgentAction | AgentFinish> {



        const nextMessage = this.getMessageForAI(steps, inputs);
        const context: AgentContext = {
            input: nextMessage,
            memory: this.memory,
        }
        let message = nextMessage;
        for (const plugin of this.plugins) {
            const newMessage = await plugin.processMessage(message, inputs);
            if (newMessage) {
                message = newMessage;
            }
        }

        const { message: langChainMessage, messageToSave } = await this.messageGenerator(message);

        const pluginInputs = (await Promise.all(this.plugins.map(async plugin => await plugin.getInputs(context))))
            .reduce((acc, val) => ({ ...acc, ...val }), {})

        const agentResponse = await this.executePlanWithRetry({
            ...this.defaultInputs,
            ...pluginInputs,
            ...inputs,
            realInput: langChainMessage,
            inputToSave: messageToSave
        });

        this.plugins.forEach(plugin => plugin.readResponse(context, agentResponse));

        const out = await this.outputParser.parse(JSON.stringify(agentResponse), callbackManager);
        return {
            ...out,
            log: out.log,
        };
    }

    finishToolName(): string {
        return this.taskCompleteCommandName;
    }

    /**
     * Return response when agent has been stopped due to max iterations
     */
    returnStoppedResponse(
        earlyStoppingMethod: StoppingMethod,
        _steps: AgentStep[],
        _inputs: ChainValues,
        _callbackManager?: CallbackManager
    ): Promise<AgentFinish> {
        if (earlyStoppingMethod === "force") {
            return Promise.resolve({
                returnValues: { output: JSON.stringify({ message: "I am sorry, the task could not be completed." } as AgentUserMessage) },
                log: "",
            });
        }

        throw new Error(`Invalid stopping method: ${earlyStoppingMethod}`);
    }

    private async executePlanWithRetry(inputs: Record<string, any>, retries: number = 6) {
        let attempts = 0;

        let agentResponse: MimirAIMessage | undefined;
        while (attempts < retries) {
            if (attempts >= 1) {
                const errMessage = new HumanMessage(BAD_MESSAGE_TEXT);
                agentResponse = await this.llmChain.predict({
                    ...inputs,
                    realInput: errMessage,
                    inputToSave: {
                        type: "USER_MESSAGE",
                        message: BAD_MESSAGE_TEXT,
                    } as MimirHumanReplyMessage,
                });

            } else {
                agentResponse = await this.llmChain.predict(inputs);
            }

            if (agentResponse!.error !== true) {
                return agentResponse;
            }
            console.error("Failed to parse agent message, retrying..: ", JSON.stringify(agentResponse));
            attempts++;
        }
        throw new Error("Agent failed to parse its own message: " + JSON.stringify(agentResponse ?? "Zero attempts made??"));
    }



    private getMessageForAI(steps: AgentStep[], inputs: ChainValues): NextMessage {
        return steps.length === 0 ? {
            type: "USER_MESSAGE",
            message: inputs.input
        } : {
            type: "ACTION",
            message: steps.slice(-1)[0].observation,
            tool: steps.slice(-1)[0].action.tool,
        }
    }

    static createPrompt(args: CreatePromptArgs) {
        const messages = [
            ...args.systemMessage,
            new MessagesPlaceholder("chat_history"),
            new MessagesPlaceholder("history"),
            new MessagesPlaceholder("realInput")
        ];
        const prompt = ChatPromptTemplate.fromPromptMessages(messages);
        return prompt;
    }

    public static fromLLMAndTools(
        llm: BaseLanguageModel,
        mimirOutputParser: BaseLLMOutputParser<MimirAIMessage>,
        messageGenerator: (arg: NextMessage) => Promise<{ message: BaseMessage, messageToSave: MimirHumanReplyMessage, }>,
        args: CreatePromptArgs,
    ) {

        const taskCompleteCommandName = args?.taskCompleteCommandName ?? "taskComplete";

        const { outputParser } = args ?? {};
        const prompt = MimirAgent.createPrompt(args);
        const innerMemory = new TrimmingMemory(args.memory, {
            startCollectionFilter: (messagePack) => {
                const message = getInputValue(messagePack.output, innerMemory.outputKey);
                const aiMessage = message as MimirAIMessage;
                return aiMessage.error === true;
            }
        });
        const chain = new LLMChain({ prompt, llm, memory: innerMemory, outputParser: mimirOutputParser });

        return new MimirAgent(
            innerMemory,
            taskCompleteCommandName,
            {
                outputParser: outputParser,
                llmChain: chain,
            },
            outputParser,
            messageGenerator,
            args.name,
            args.resetFunction,
            args.plugins,
            args.defaultInputs,
        );
    }
}


export type CreatePromptArgs = {

    systemMessage: (SystemMessagePromptTemplate | MessagesPlaceholder)[];

    outputParser: AgentActionOutputParser;

    taskCompleteCommandName: string,

    defaultInputs?: Record<string, any>,

    memory: BaseChatMemory;

    plugins: InternalAgentPlugin[];

    name: string;

    resetFunction: () => Promise<void>;

};

