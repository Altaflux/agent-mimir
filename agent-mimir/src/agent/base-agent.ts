import { AgentAction, AgentActionOutputParser, AgentFinish, AgentStep, BaseSingleActionAgent, StoppingMethod } from "langchain/agents";
import { TrimmingMemory } from "./../memory/trimming-memory/index.js";
import { LLMChain } from "langchain/chains";
import { BaseLanguageModel } from "langchain/base_language";
import { AgentContext, AgentSystemMessage, AgentUserMessage, MimirHumanReplyMessage, NextMessage, ToolResponse } from "../schema.js";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { BaseLLMOutputParser, BaseOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { BaseChatMemory, getInputValue } from "langchain/memory";
import { BaseMessage, HumanMessage, MessageContentComplex, MessageContentText, SystemMessage } from "@langchain/core/messages";
import { ChainValues } from "@langchain/core/utils/types";


const BAD_MESSAGE_TEXT = `I could not understand your response, please rememeber to use the correct response format using the appropiate functions. If you need to tell me something, please use the "respondBack" function.`;

export type MimirChatConversationalAgentInput = {
    llmChain: LLMChain<MimirAIMessage>;
    outputParser: AgentActionOutputParser | undefined;
};


export type InternalAgentPlugin = {

    getSystemMessages: (context: AgentContext) => Promise<AgentSystemMessage>,
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
    reset: () => Promise<void>;
    messageGenerator: (arg: NextMessage,) => Promise<{ message: BaseMessage, messageToSave: MimirHumanReplyMessage, }>;

    constructor(
        memory: BaseChatMemory,
        taskCompleteCommandName: string,
        input: MimirChatConversationalAgentInput,
        outputParser: BaseOutputParser<AgentAction | AgentFinish>,
        messageGenerator: (arg: NextMessage,) => Promise<{ message: BaseMessage, messageToSave: MimirHumanReplyMessage, }>,
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

        const pluginInputs = (await Promise.all(
            this.plugins.map(async (plugin) => await plugin.getSystemMessages(context))
        ))

        const systemMessage = buildSystemMessage(pluginInputs);
        const agentResponse = await this.executePlanWithRetry({
            ...this.defaultInputs,
            system_message: systemMessage,
            ...inputs,
            realInput: langChainMessage,
            inputToSave: messageToSave
        });

        this.plugins.forEach(plugin => plugin.readResponse(context, agentResponse));
        try {
            const out = await this.outputParser.parse(JSON.stringify(agentResponse), callbackManager);
            return {
                ...out,
                log: out.log,
            };
        }
        catch (error) {
            console.error("Error while parsing agent response: ", error);
            return {
                tool: "",
                toolInput: ({} as ToolResponse) as any,
                log: JSON.stringify(agentResponse),
            };
        }
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
                        content: [
                            {
                                type: "text",
                                text: BAD_MESSAGE_TEXT
                            }
                        ],
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
            content: [
                {
                    type: "text" as const,
                    text: (inputs.input as string) // TODO THIS IS PROBABLY WRONG!!!!
                }
            ],
        } : {
            type: "ACTION",
            jsonPayload: steps.slice(-1)[0].observation,
            tool: steps.slice(-1)[0].action.tool,
        }
    }

    static createPrompt(args: CreatePromptArgs) {
        const messages = [
            new MessagesPlaceholder("system_message"),
            new MessagesPlaceholder("chat_history"),
            new MessagesPlaceholder("history"),
            new MessagesPlaceholder("realInput")
        ];
        const prompt = ChatPromptTemplate.fromMessages(messages);
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
            args.resetFunction,
            [systemMessageToPlugin(args.systemMessage), ...args.plugins],
            args.defaultInputs,
        );
    }
}


export type CreatePromptArgs = {

    systemMessage: AgentSystemMessage;

    outputParser: AgentActionOutputParser;

    taskCompleteCommandName: string,

    defaultInputs?: Record<string, any>,

    memory: BaseChatMemory;

    plugins: InternalAgentPlugin[];

    resetFunction: () => Promise<void>;

};


function mergeSystemMessages(messages: SystemMessage[]) {
    return messages.reduce((prev, next) => {
        const prevContent = (prev.content instanceof String) ? [{
            type: "text",
            text: prev.content
        }] as MessageContentText[] : prev.content as MessageContentComplex[];
        const nextContent = (next.content instanceof String) ? [{
            type: "text",
            text: next.content
        }] as MessageContentText[] : next.content as MessageContentComplex[];

        return new SystemMessage({ content: [...prevContent, ...nextContent] });
    }, new SystemMessage({ content: [] }))

}
const dividerSystemMessage = new SystemMessage({
    content: [
        {
            type: "text",
            text: "\n\n--------------------------------------------------\n\n"
        }
    ]
});
function buildSystemMessage(agentSystemMessages: AgentSystemMessage[]) {
    const messages = agentSystemMessages.map((m) => {
        return mergeSystemMessages([dividerSystemMessage, new SystemMessage({ content: m.content })])
    });

    const finalMessage = mergeSystemMessages(messages);
    const content = finalMessage.content as MessageContentComplex[];
    const containsOnlyText = content.find((f) => f.type !== "text") === undefined;
    if (containsOnlyText) {
        const systemMessageText = content.reduce((prev, next) => {
            return prev + (next as MessageContentText).text
        }, "");

        return new SystemMessage(systemMessageText);
    }
    return finalMessage;
}

function systemMessageToPlugin(systemMessage: AgentSystemMessage): InternalAgentPlugin {
    return {
        getSystemMessages: async (context) => systemMessage,
        readResponse: async (context: AgentContext, response: MimirAIMessage) => { },
        clear: async () => { },
        processMessage: async function (nextMessage: NextMessage, inputs: ChainValues): Promise<NextMessage | undefined> {
            return nextMessage;
        }
    }
}

