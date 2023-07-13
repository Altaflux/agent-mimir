import { AgentActionOutputParser, BaseSingleActionAgent } from "langchain/agents";
import { CallbackManager, CallbackManagerForChainRun } from "langchain/callbacks";
import { AgentAction, AgentFinish, AgentStep, BasePromptValue, ChainValues, ChatGeneration, FunctionChatMessage, Generation } from "langchain/schema";
import { LongTermMemoryManager } from "../../memory/long-term-memory.js";
import { AIMessageSerializer, AIMessageType, AgentManager } from "../../index.js";
import { BaseChatMemory, BufferMemory, getInputValue } from "langchain/memory";
import { ScratchPadManager } from "../../utils/scratch-pad.js";
import { CreatePromptArgs } from "../index.js";
import { StructuredTool } from "langchain/tools";
import { PREFIX_JOB } from "./prompt.js";
import { ChatPromptTemplate,  MessagesPlaceholder, PromptTemplate, SystemMessagePromptTemplate, renderTemplate } from "langchain/prompts";
import { JsonSchema7ObjectType } from "zod-to-json-schema/src/parsers/object.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FunctionCallAiMessageSerializer, HumanMessageSerializerImp, PlainTextMessageSerializer, deserializeWithFunction } from "../../parser/plain-text-parser/index.js";
import { TrimmingMemory } from "../../memory/trimming-memory/index.js";
import { ConversationChain, LLMChain, LLMChainInput } from "langchain/chains";
import { BaseLLMOutputParser, BaseOutputParser } from "langchain/schema/output_parser";
import { BaseLanguageModel } from "langchain/base_language";
import { createBulletedList } from "../../utils/format.js";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { HumanChatMessage } from "langchain/schema";
import { FORMAT_INSTRUCTIONS_WITHOUT_COMMAND } from "../../parser/plain-text-parser/prompt.js";
import { TransformationalMemory } from "../../memory/transform-memory.js";
// const model = new ChatOpenAI({
//     temperature: 0.9,
//     openAIApiKey: "YOUR-API-KEY", // In Node.js defaults to process.env.OPENAI_API_KEY
//   });


const BAD_MESSAGE_TEXT = `I could not understand that your response, please rememeber to use the correct response format and always include a valid "command" value and "command_text" fields!.`;


type NextMessage = {
    type: "ACTION" | "USER_MESSAGE",
    message: string,
    tool?: string,
}
export type MimirChatConversationalAgentInput = {
    tools: StructuredTool[],
    llmChain: LLMChain<MimirAIMessage>;
    outputParser: AgentActionOutputParser | undefined;
};
export class ChatConversationalAgentOutputParser extends BaseOutputParser<AgentAction | AgentFinish> {

    constructor(private finishToolName: string, private talkToUserTool: string| undefined,  private messageSerializer: AIMessageSerializer) {
        super();
    }

    lc_namespace = ["langchain", "agents", "output-parser"]

    async parse(input: string): Promise<AgentAction | AgentFinish> {
        const out = JSON.parse(input) as AIMessageType;
        //TODO HACK!
        if (this.talkToUserTool && !out.action && out.messageToUser && out.messageToUser.length > 1) {
            out.action = this.talkToUserTool;
            out.action_input = { messageToUser: out.messageToUser };
        }
        const action = { tool: out.action, toolInput: out.action_input, log: input }
        if (action.tool === this.finishToolName) {
            return { returnValues: { output: action.toolInput, complete: true }, log: action.log };
        }
        return action;
    }

    getFormatInstructions(): string {
        return this.messageSerializer.getFormatInstructions();
    }
}


export class Gpt4FunctionAgent extends BaseSingleActionAgent {
    outputParser: BaseOutputParser<AgentAction | AgentFinish>;
    longTermMemoryManager?: LongTermMemoryManager
    taskCompleteCommandName: string
    memory: BaseChatMemory;
    messageSerializer: AIMessageSerializer;
    helper?: AgentManager;
    name?: string;
    scratchPad?: ScratchPadManager
    currentTaskList: string[] = [];
    communicationWhitelist: string[] | null;
    tools: StructuredTool[];
    talkToUserTool?: StructuredTool
    get inputKeys(): string[] {
        return this.llmChain.inputKeys;
    }

    lc_namespace: string[] = [];

    llmChain: LLMChain<MimirAIMessage>;
    constructor(
        memory: BaseChatMemory,
        taskCompleteCommandName: string,
        input: MimirChatConversationalAgentInput,
        name: string,
        messageSerializer: AIMessageSerializer,
        talkToUserTool?: StructuredTool,
        outputParser?: BaseOutputParser<AgentAction | AgentFinish>,
        longTermMemoryManager?: LongTermMemoryManager,
        helper?: AgentManager,
        scratchPad?: ScratchPadManager,
        communicationWhitelist?: string[] | null,


    ) {
        super(input);
        this.tools = input.tools;
        this.llmChain = input.llmChain;
        this.taskCompleteCommandName = taskCompleteCommandName;
        this.outputParser =
            outputParser ?? new ChatConversationalAgentOutputParser(this.taskCompleteCommandName, talkToUserTool?.name, messageSerializer);
        this.longTermMemoryManager = longTermMemoryManager;
        this.memory = memory;
        this.talkToUserTool = talkToUserTool;
        this.helper = helper;
        this.name = name;
        this.scratchPad = scratchPad;
        this.messageSerializer = messageSerializer;
        this.communicationWhitelist = communicationWhitelist ?? null;
    }

    static validateTools(tools: StructuredTool[]) {
        const invalidTool = tools.find((tool) => !tool.description);
        if (invalidTool) {
            const msg =
                `Got a tool ${invalidTool.name} without a description.` +
                ` This agent requires descriptions for all tools.`;
            throw new Error(msg);
        }
    }

    async prepareForOutput(
        _returnValues: AgentFinish["returnValues"],
        _steps: AgentStep[]
    ): Promise<AgentFinish["returnValues"]> {
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
        const scratchPadElements = await this.scratchPad?.buildScratchPadList() ?? "";
        const currentPlan = createBulletedList(this.currentTaskList);

        // const realInput = nextMessage.type === "USER_MESSAGE" ? renderTemplate(USER_INPUT, "f-string", {
        //     input: nextMessage.message,
        // }) : renderTemplate(TEMPLATE_TOOL_RESPONSE, "f-string", {
        //     observation: nextMessage.message,
        //     current_plan: currentPlan
        // });
        const realInput = nextMessage.type === "USER_MESSAGE" ? new HumanChatMessage(nextMessage.message) : new FunctionChatMessage(nextMessage.message, nextMessage.tool!);

        const relevantMemory = await this.longTermMemoryManager?.retrieveMessages(nextMessage.message, 3) ?? "";
        //const relevantMemory = "";
        const helperStrings = await this.buildHelperPrompt();

        const agentResponse = await this.executePlanWithRetry({
            ...inputs,
            tools: this.tools,////////////////////
            realInput: realInput,
            relevantMemory: relevantMemory,
            helper_prompt: helperStrings,
            scratchpad_items: scratchPadElements,
            currentTime: new Date().toISOString(),
            inputToSave: realInput
        });

        let aiMessage = await JSON.parse(agentResponse.log) as AIMessageType;

        if (aiMessage.saveToScratchPad && aiMessage.saveToScratchPad.length > 1) {
            this.scratchPad?.storeMessage(aiMessage.saveToScratchPad);
        }

        if ((aiMessage.plan?.length ?? 0) > 0) {
            this.currentTaskList = aiMessage.plan!;
        }
        const messageToStore = nextMessage.type === "USER_MESSAGE"
            ? ("User Message: " + nextMessage.message)
            : ("Command Response: " + nextMessage.message);
        await this.longTermMemoryManager?.storeMessage(messageToStore, agentResponse.log);

        if (aiMessage.action === this.finishToolName()) {
            console.log("----Clearing memory---");
            this.scratchPad?.clear();
            this.longTermMemoryManager?.clear()
            this.currentTaskList = [];
            await this.memory.clear()
        }

        return {
            ...agentResponse,
            log: agentResponse.log,
        };
    }

    finishToolName(): string {
        return this.taskCompleteCommandName;
    }

    private async executeChain(
        inputs: ChainValues,
        callbackManager?: CallbackManager
    ): Promise<AgentAction | AgentFinish> {

        const output1 = await this.llmChain.predict(inputs, callbackManager);
        if (!this.outputParser) {
            throw new Error("Output parser not set");
        }
        const output =  await deserializeWithFunction(output1.text!, output1.functionCall?.name!, output1.functionCall?.arguments!);
        //TODO: This is a hack to use "message to user" as the talkToUser tool.
    
        return this.outputParser.parse(JSON.stringify(output), callbackManager);
    }

    private async executePlanWithRetry(inputs: Record<string, any>, retries: number = 6) {
        let attempts = 0;

        let agentResponse: AgentAction | AgentFinish | undefined;
        while (attempts < retries) {
            if (attempts >= 1) {
                agentResponse = await this.executeChain({
                    ...inputs,
                    realInput: BAD_MESSAGE_TEXT
                });
            } else {
                agentResponse = await this.executeChain(inputs);
            }

            const aiMessage = await JSON.parse(agentResponse.log) as AIMessageType;
            if (aiMessage!.action !== "PARSING_ERROR") {
                return agentResponse;
            }
            console.error("Failed to parse agent message, retrying..: ", JSON.stringify(aiMessage));
            attempts++;
        }
        throw new Error("Agent failed to parse its own message: " + JSON.stringify(agentResponse ?? "Zero attempts made??"));
    }

    private async buildHelperPrompt() {
        const helpers = this.helper?.getAllAgents() ?? [];
        const whiteList = this.communicationWhitelist ?? helpers.map((helper) => helper.name) ?? [];
        const helperList = helpers.filter((helper) => helper.name !== this.name)
            .filter(element => whiteList.includes(element.name))
            .map((helper) => `${helper.name}: ${helper.description}`)
            .join("\n") ?? "";
        return helperList !== "" ? `You have the following helpers that can be used to assist you in your task:\n${helperList}` : ``;
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
    static createToolSchemasString(tools: StructuredTool[]) {
        return tools
            .map(
                (tool) =>
                    `${tool.name}: ${tool.description}, args: ${JSON.stringify(
                        (zodToJsonSchema(tool.schema) as JsonSchema7ObjectType).properties
                    )}`
            )
            .join("\n");
    }

    static createPrompt(tools: StructuredTool[], outputParser: AgentActionOutputParser, args?: CreatePromptArgs) {
        const {
            systemMessage = PREFIX_JOB("Assistant", "a helpful assistant"),
        } = args ?? {};

        // const template = [systemMessage, outputParser.getFormatInstructions(), humanMessage].join("\n\n");
        const template = [systemMessage, FORMAT_INSTRUCTIONS_WITHOUT_COMMAND].join("\n\n");

        const messages = [
            new SystemMessagePromptTemplate(
                new PromptTemplate({
                    template: template,
                    inputVariables: ["helper_prompt", "scratchpad_items"],
                    // partialVariables: {
                    //     tools: Gpt4FunctionAgent.createToolSchemasString(tools),
                    //     tool_names: tools.map((tool) => tool.name).join(", "),
                    //     json_instructions: JSON_INSTRUCTIONS,
                    // },
                })
            ),
            SystemMessagePromptTemplate.fromTemplate(`The current time is: {currentTime}`),
            SystemMessagePromptTemplate.fromTemplate("This reminds you of these events from your past:\n{relevantMemory}"),
            new MessagesPlaceholder("chat_history"),
            new MessagesPlaceholder("history"),
            new MessagesPlaceholder("realInput"),
            //HumanMessagePromptTemplate.fromTemplate(`{realInput}`),
        ];
        const prompt = ChatPromptTemplate.fromPromptMessages(messages);
        return prompt;
    }

    public static fromLLMAndTools(
        llm: BaseLanguageModel,
        tools: StructuredTool[],
        args?: CreatePromptArgs,
    ) {
        const expandedTools = [...tools]
        Gpt4FunctionAgent.validateTools(expandedTools);

        const taskCompleteCommandName = args?.taskCompleteCommandName ?? "taskComplete";
        const talkToUserTool = args?.talkToUserTool;
        const serializer = args?.messageSerializer ?? new PlainTextMessageSerializer();
        const { outputParser = new ChatConversationalAgentOutputParser(taskCompleteCommandName, talkToUserTool?.name, serializer) } =
            args ?? {};

        const prompt = Gpt4FunctionAgent.createPrompt(expandedTools, outputParser, args);
        const innerMemory = new TrimmingMemory(args?.memory ?? new BufferMemory({ returnMessages: true, memoryKey: "history", inputKey: "realInput" }), {
            startCollectionFilter: (messagePack) => {
                const message = getInputValue(messagePack.output, innerMemory.outputKey);
                const aiMessage = message as MimirAIMessage;
                return (aiMessage.functionCall?.name ?? "") === "PARSING_ERROR";
            }
        });

        const transformMemory = new TransformationalMemory(innerMemory, new FunctionCallAiMessageSerializer(), new HumanMessageSerializerImp());
        const chain = new LLMChain({ prompt, llm, memory: transformMemory, outputParser: new AIMessageLLMOutputParser() });
        //const chain = new FunctionChatLLM({ prompt, llm, memory: transformMemory, outputParser: undefined });

        return new Gpt4FunctionAgent(
            innerMemory,
            taskCompleteCommandName,
            {
                outputParser: outputParser,
                llmChain: chain,
                tools: expandedTools,
            },
            args?.name ?? "Assistant",
            serializer,
            args?.talkToUserTool,
            outputParser,
            args?.embedding ? new LongTermMemoryManager(args.embedding) : undefined,
            args?.helper,
            args?.scratchPad,
            args?.communicationWhitelist,
        );
    }
}


export type MimirAIMessage = {
    functionCall?: {
        name: string,
        arguments: string
    },
    text?: string,
}
class AIMessageLLMOutputParser extends BaseLLMOutputParser<MimirAIMessage> {
    async parseResult(generations: Generation[] | ChatGeneration[]): Promise<MimirAIMessage> {
        const generation = generations[0] as ChatGeneration;
        const functionCall: any = generation.message?.additional_kwargs?.function_call
       
        return {
            functionCall: {
                name:  functionCall?.name,
                arguments: functionCall?.arguments
            },
            text: generation.text,
        }
        //
    }
    lc_namespace: string[] = [];

}
