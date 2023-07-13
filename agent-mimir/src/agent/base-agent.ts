import { AgentActionOutputParser, BaseSingleActionAgent } from "langchain/agents";
import { CallbackManager } from "langchain/callbacks";
import { AgentAction, AgentFinish, AgentStep, BaseChatMessage, ChainValues } from "langchain/schema";
import { BaseChatMemory, BufferMemory, getInputValue } from "langchain/memory";
import { ChatPromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { FunctionCallAiMessageSerializer, HumanMessageSerializerImp } from "./../parser/plain-text-parser/index.js";
import { TrimmingMemory } from "./../memory/trimming-memory/index.js";
import { LLMChain } from "langchain/chains";
import { BaseLLMOutputParser, BaseOutputParser } from "langchain/schema/output_parser";
import { BaseLanguageModel } from "langchain/base_language";
import { HumanChatMessage } from "langchain/schema";
import { TransformationalMemory } from "./../memory/transform-memory.js";



const BAD_MESSAGE_TEXT = `I could not understand that your response, please rememeber to use the correct response format.`;


export type NextMessage = {
    type: "ACTION" | "USER_MESSAGE",
    message: string,
    tool?: string,
}
export type MimirChatConversationalAgentInput = {
    llmChain: LLMChain<MimirAIMessage>;
    outputParser: AgentActionOutputParser | undefined;
};



export class Gpt4FunctionAgent extends BaseSingleActionAgent {

    outputParser: BaseOutputParser<AgentAction | AgentFinish>;
    taskCompleteCommandName: string
    memory: BaseChatMemory;
    lc_namespace: string[] = [];
    llmChain: LLMChain<MimirAIMessage>;
    defaultInputs?: Record<string, any>;
    messageGenerator: (arg: NextMessage) => Promise<{ message: BaseChatMessage, messageToSave: BaseChatMessage, }>;

    constructor(
        memory: BaseChatMemory,
        taskCompleteCommandName: string,
        input: MimirChatConversationalAgentInput,
        outputParser: BaseOutputParser<AgentAction | AgentFinish>,
        messageGenerator: (arg: NextMessage) => Promise<{ message: BaseChatMessage, messageToSave: BaseChatMessage, }>,
        defaultInputs?: Record<string, any>,
    ) {
        super(input);
        this.llmChain = input.llmChain;
        this.taskCompleteCommandName = taskCompleteCommandName;
        this.outputParser = outputParser;
        this.memory = memory;
        this.messageGenerator = messageGenerator;
        this.defaultInputs = defaultInputs;

    }

    get inputKeys(): string[] {
        return this.llmChain.inputKeys;
    }

    async prepareForOutput(
        _returnValues: AgentFinish["returnValues"],
        _steps: AgentStep[]
    ): Promise<AgentFinish["returnValues"]> {
        //This has to match the input of the Finish Tool.
        return {
            complete: _returnValues.complete ?? false,
            output: _returnValues.output.messageToUser ?? _returnValues.output,
        };
    }

    async plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager,
    ): Promise<AgentAction | AgentFinish> {

        const nextMessage = this.getMessageForAI(steps, inputs);
        const { message, messageToSave} = await this.messageGenerator(nextMessage);

        const agentResponse = await this.executePlanWithRetry({
            ...this.defaultInputs,
            ...inputs,
            currentTime: new Date().toISOString(),
            realInput: message,
            inputToSave: messageToSave
        });


        if (agentResponse.functionCall?.name === this.finishToolName()) {
            await this.memory.clear()
        }

        const out = await this.outputParser.parse(JSON.stringify(agentResponse), callbackManager);
        return {
            ...out,
            log: out.log,
        };
    }

    finishToolName(): string {
        return this.taskCompleteCommandName;
    }


    private async executePlanWithRetry(inputs: Record<string, any>, retries: number = 6) {
        let attempts = 0;

        let agentResponse: MimirAIMessage | undefined;
        while (attempts < retries) {
            if (attempts >= 1) {
                const errMessage = new HumanChatMessage(BAD_MESSAGE_TEXT);
                agentResponse = await this.llmChain.predict({
                    ...inputs,
                    realInput: errMessage,
                    inputToSave: errMessage
                });

            } else {
                agentResponse = await this.llmChain.predict(inputs);
            }

            if (agentResponse!.functionCall?.name !== "PARSING_ERROR") {
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
            SystemMessagePromptTemplate.fromTemplate(`The current time is: {currentTime}`),
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
        messageGenerator: (arg: NextMessage) => Promise<{ message: BaseChatMessage, messageToSave: BaseChatMessage, }>,
        args: CreatePromptArgs,
    ) {

        const taskCompleteCommandName = args?.taskCompleteCommandName ?? "taskComplete";

        const { outputParser } = args ?? {};

        const prompt = Gpt4FunctionAgent.createPrompt(args);
        const innerMemory = new TrimmingMemory(args?.memory ?? new BufferMemory({ returnMessages: true, memoryKey: "history", inputKey: "realInput" }), {
            startCollectionFilter: (messagePack) => {
                const message = getInputValue(messagePack.output, innerMemory.outputKey);
                const aiMessage = message as MimirAIMessage;
                return (aiMessage.functionCall?.name ?? "") === "PARSING_ERROR";
            }
        });

        const transformMemory = new TransformationalMemory(innerMemory, new FunctionCallAiMessageSerializer(), new HumanMessageSerializerImp());
        const chain = new LLMChain({ prompt, llm, memory: transformMemory, outputParser: mimirOutputParser });

        return new Gpt4FunctionAgent(
            innerMemory,
            taskCompleteCommandName,
            {
                outputParser: outputParser,
                llmChain: chain,
            },
            outputParser,
            messageGenerator,
            args.defaultInputs
        );
    }
}


export type CreatePromptArgs = {

    systemMessage: SystemMessagePromptTemplate[];

    humanMessage?: string;

    inputVariables?: string[];

    outputParser: AgentActionOutputParser;

    taskCompleteCommandName: string,

    memory?: BaseChatMemory,

    defaultInputs?: Record<string, any>,

    communicationWhitelist?: string[] | null;

};
export type MimirAIMessage = {
    functionCall?: {
        name: string,
        arguments: string
    },
    text?: string,
}
