import {
    SystemMessagePromptTemplate,
    HumanMessagePromptTemplate,
    ChatPromptTemplate,
    MessagesPlaceholder,
    PromptTemplate,
} from "langchain/prompts";
import { renderTemplate } from "langchain/prompts";
import {
    SUFFIX,
    TEMPLATE_TOOL_RESPONSE,
    USER_INPUT,
    PREFIX_JOB,
    JSON_INSTRUCTIONS,
} from "./prompt.js";


import {
    AgentStep,
    BaseChatMessage,
    AIChatMessage,
    HumanChatMessage,
    ChainValues,
    AgentAction,
    AgentFinish,
} from "langchain/schema";
import { BaseOutputParser } from "langchain/schema/output_parser";

import { StructuredTool } from "langchain/tools";
import { Agent, AgentActionOutputParser, AgentInput } from "langchain/agents";
import { BaseLanguageModel } from "langchain/base_language";
import { ConversationChain } from "langchain/chains";
import { BaseChatMemory, BufferMemory, getInputValue } from "langchain/memory";
import { Embeddings } from "langchain/embeddings/base";
import { AIMessageSerializer } from "../schema.js";
import { ScratchPadManager } from "../utils/scratch-pad.js";
import { LongTermMemoryManager } from "../memory/long-term-memory.js";
import { createBulletedList } from "../utils/format.js";
import { TrimmingMemory } from "../memory/trimming-memory/index.js";
import { PlainTextMessageSerializer } from "../parser/plain-text-parser/index.js";
import { AgentManager } from "../index.js";
import { JsonSchema7ObjectType } from "zod-to-json-schema/src/parsers/object.js";
import { zodToJsonSchema } from "zod-to-json-schema";

const BAD_MESSAGE_TEXT = `I could not understand that your response, please rememeber to use the correct response format and always include a valid "command" value and "command_text" fields!.`;

export type AIMessageType = {
    thoughts?: string,
    reasoning?: string,
    saveToScratchPad?: string,
    currentPlanStep?: string,
    action: string,
    action_input: string,
    plan?: string[],
}

export class ChatConversationalAgentOutputParser extends AgentActionOutputParser {

    constructor(private finishToolName: string, private messageSerializer: AIMessageSerializer) {
        super();
    }

    async parse(input: string): Promise<AgentAction | AgentFinish> {
        const out = JSON.parse(input) as AIMessageType;

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



export type CreatePromptArgs = {

    systemMessage?: string;

    humanMessage?: string;

    inputVariables?: string[];

    outputParser?: AgentActionOutputParser;

    taskCompleteCommandName: string,

    memory: BaseChatMemory,

    scratchPad?: ScratchPadManager,

    embedding?: Embeddings,
    helper?: AgentManager;
    name?: string;
    messageSerializer: AIMessageSerializer;
    communicationWhitelist?: string[] | null;

};

type NextMessage = {
    type: "ACTION" | "USER_MESSAGE",
    message: string,
}

export type MimirChatConversationalAgentInput = AgentInput;

/**
 * Agent for the MRKL chain.
 * @augments Agent
 */
export class MimirChatConversationalAgent extends Agent {
    outputParser: AgentActionOutputParser;
    longTermMemoryManager?: LongTermMemoryManager
    taskCompleteCommandName: string
    memory: BaseChatMemory;
    messageSerializer: AIMessageSerializer;
    helper?: AgentManager;
    name?: string;
    scratchPad?: ScratchPadManager
    currentTaskList: string[] = [];
    communicationWhitelist: string[] | null;

    constructor(
        memory: BaseChatMemory,
        taskCompleteCommandName: string,
        input: MimirChatConversationalAgentInput,
        name: string,
        messageSerializer: AIMessageSerializer,
        outputParser?: AgentActionOutputParser,
        longTermMemoryManager?: LongTermMemoryManager,
        helper?: AgentManager,
        scratchPad?: ScratchPadManager,
        communicationWhitelist?: string[] | null,

    ) {
        super(input);
        this.taskCompleteCommandName = taskCompleteCommandName;
        this.outputParser =
            outputParser ?? new ChatConversationalAgentOutputParser(this.taskCompleteCommandName, messageSerializer);
        this.longTermMemoryManager = longTermMemoryManager;
        this.memory = memory;
        this.helper = helper;
        this.name = name;
        this.scratchPad = scratchPad;
        this.messageSerializer = messageSerializer;
        this.communicationWhitelist = communicationWhitelist ?? null;
    }

    _agentType(): string {
        throw new Error("Method not implemented.");
    }

    observationPrefix() {
        return "Observation: ";
    }

    llmPrefix() {
        return "Thought:";
    }

    _stop(): string[] {
        return ["Observation:"];
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


    async constructScratchPad(steps: AgentStep[]): Promise<BaseChatMessage[]> {
        const thoughts: BaseChatMessage[] = [];
        for (const step of steps) {
            thoughts.push(new AIChatMessage(step.action.log));
            thoughts.push(
                new HumanChatMessage(
                    renderTemplate(TEMPLATE_TOOL_RESPONSE, "f-string", {
                        observation: step.observation,
                        current_plan: ""
                    })
                )
            );
        }
        return thoughts;
    }

    finishToolName(): string {
        return this.taskCompleteCommandName;
    }

    async prepareForOutput(
        _returnValues: AgentFinish["returnValues"],
        _steps: AgentStep[]
    ): Promise<AgentFinish["returnValues"]> {
        return {
            complete: _returnValues.complete ?? false,
        };
    }

    async plan(
        steps: AgentStep[],
        inputs: ChainValues
    ): Promise<AgentAction | AgentFinish> {

        const nextMessage = this.getMessageForAI(steps, inputs);
        const scratchPadElements = await this.scratchPad?.buildScratchPadList() ?? "";
        const currentPlan = createBulletedList(this.currentTaskList);

        const realInput = nextMessage.type === "USER_MESSAGE" ? renderTemplate(USER_INPUT, "f-string", {
            input: nextMessage.message,
        }) : renderTemplate(TEMPLATE_TOOL_RESPONSE, "f-string", {
            observation: nextMessage.message,
            current_plan: currentPlan
        });

        const relevantMemory = await this.longTermMemoryManager?.retrieveMessages(nextMessage.message, 3) ?? "";
        const helperStrings = await this.buildHelperPrompt();

        const agentResponse = await this.executePlanWithRetry(steps, {
            ...inputs,
            realInput,
            relevantMemory: relevantMemory,
            helper_prompt: helperStrings,
            scratchpad_items: scratchPadElements,
            currentTime: new Date().toISOString(),
            inputToSave: nextMessage.message
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

    private async executePlanWithRetry(steps: AgentStep[], inputs: Record<string, any>, retries: number = 6) {
        let attempts = 0;

        let agentResponse: AgentAction | AgentFinish | undefined;
        while (attempts < retries) {
            if (attempts >= 1) {
                agentResponse = await super.plan(steps, {
                    ...inputs,
                    realInput: BAD_MESSAGE_TEXT
                });
            } else {
                agentResponse = await super.plan(steps, inputs);
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
            message: steps.slice(-1)[0].observation
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
            humanMessage = SUFFIX,
        } = args ?? {};

        const template = [systemMessage, outputParser.getFormatInstructions(), humanMessage].join("\n\n");

        const messages = [
            new SystemMessagePromptTemplate(
                new PromptTemplate({
                    template: template,
                    inputVariables: ["helper_prompt", "scratchpad_items"],
                    partialVariables: {
                        tools: MimirChatConversationalAgent.createToolSchemasString(tools),
                        tool_names: tools.map((tool) => tool.name).join(", "),
                        json_instructions: JSON_INSTRUCTIONS,
                    },
                })
            ),
            SystemMessagePromptTemplate.fromTemplate(`The current time is: {currentTime}`),
            SystemMessagePromptTemplate.fromTemplate("This reminds you of these events from your past:\n{relevantMemory}"),
            new MessagesPlaceholder("chat_history"),
            new MessagesPlaceholder("history"),
            HumanMessagePromptTemplate.fromTemplate(`{realInput}`),
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
        MimirChatConversationalAgent.validateTools(expandedTools);

        const taskCompleteCommandName = args?.taskCompleteCommandName ?? "taskComplete";
        const serializer = args?.messageSerializer ?? new PlainTextMessageSerializer();
        const { outputParser = new ChatConversationalAgentOutputParser(taskCompleteCommandName, serializer) } =
            args ?? {};

        const prompt = MimirChatConversationalAgent.createPrompt(expandedTools, outputParser, args);
        const innerMemory = new TrimmingMemory(args?.memory ?? new BufferMemory({ returnMessages: true, memoryKey: "history", inputKey: "realInput" }), {
            startCollectionFilter: (messagePack) => {
                const message = getInputValue(messagePack.output, innerMemory.outputKey);
                const aiMessage = JSON.parse(message) as AIMessageType;
                return aiMessage.action === "PARSING_ERROR";
            }
        });

        const chain = new ConversationChain({ prompt, llm, memory: innerMemory, outputParser: new AgentOutputParser(serializer) });

        return new MimirChatConversationalAgent(
            innerMemory,
            taskCompleteCommandName,
            {
                outputParser: outputParser,
                llmChain: chain,
                allowedTools: expandedTools.map((t) => t.name),
            },
            args?.name ?? "Assistant",
            serializer,
            outputParser,
            args?.embedding ? new LongTermMemoryManager(args.embedding) : undefined,
            args?.helper,
            args?.scratchPad,
            args?.communicationWhitelist,
        );
    }
}


class AgentOutputParser extends BaseOutputParser<string> {
    constructor(private messageSerializer: AIMessageSerializer) {
        super();
    }

    async parse(text: string): Promise<string> {
        const result = await this.messageSerializer.deserialize(text);
        return JSON.stringify(result, null, 2);
    }
    getFormatInstructions(): string {
        throw new Error("Method not implemented.");
    }

}
