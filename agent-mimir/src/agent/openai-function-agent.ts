import { BaseLLMOutputParser } from "langchain/schema/output_parser";
import { MimirAgent, InternalAgentPlugin, MimirAIMessage, NextMessage } from "./base-agent.js";
import { AIMessage, AgentAction, AgentFinish, BaseMessage, ChatGeneration, FunctionMessage, Generation, HumanMessage } from "langchain/schema";

import { SystemMessagePromptTemplate } from "langchain/prompts";
import { AttributeDescriptor, ResponseFieldMapper } from "./instruction-mapper.js";

import { AgentActionOutputParser } from "langchain/agents";
import { AgentContext, MimirAgentArgs, MimirHumanReplyMessage } from "../schema.js";
import { DEFAULT_ATTRIBUTES, IDENTIFICATION } from "./prompt.js";
import { AiMessageSerializer, HumanMessageSerializer, TransformationalChatMessageHistory } from "../memory/transform-memory.js";


type AIMessageType = {

    messageToUser?: string,
}
export class ChatConversationalAgentOutputParser extends AgentActionOutputParser {

    constructor(private responseFieldMapper: ResponseFieldMapper<AIMessageType>, private finishToolName: string, private talkToUserTool: string | undefined) {
        super();
    }

    lc_namespace = ["langchain", "agents", "output-parser"]

    async parse(input: string): Promise<AgentAction | AgentFinish> {
        const out1 = JSON.parse(input) as MimirAIMessage;
        let out = {} as AIMessageType;
        if (out1.text && out1.text.length !== 0) {
            out = await this.responseFieldMapper.readInstructionsFromResponse(out1.text);
        }

        if (this.talkToUserTool && !out1.functionCall?.name) {
            const messageToUser = out.messageToUser && out.messageToUser.length > 1 ? out.messageToUser : input;
            out1.functionCall = {
                name: this.talkToUserTool,
                arguments: JSON.stringify({ messageToUser: messageToUser })
            };
        }
        const action = { tool: out1.functionCall!.name, toolInput: JSON.parse(out1.functionCall!.arguments), log: input }
        if (action.tool === this.finishToolName) {
            return { returnValues: { output: action.toolInput, complete: true }, log: action.log };
        }
        //TODO HACK! as toolInput expects a string but actually wants a record
        return action as any as AgentAction;
    }

    getFormatInstructions(): string {
        return ""
    }
}


export class AIMessageLLMOutputParser extends BaseLLMOutputParser<MimirAIMessage> {
    async parseResult(generations: Generation[] | ChatGeneration[]): Promise<MimirAIMessage> {
        const generation = generations[0] as ChatGeneration;
        const functionCall: any = generation.message?.additional_kwargs?.function_call
        const mimirMessage = {
            functionCall: functionCall ? {
                name: functionCall?.name,
                arguments: (functionCall?.arguments),
            } : undefined,
            text: generation.text,
        }
        return mimirMessage;
    }
    lc_namespace: string[] = [];
}

const messageGenerator: (nextMessage: NextMessage) => Promise<{ message: BaseMessage, messageToSave: MimirHumanReplyMessage, }> = async (nextMessage: NextMessage) => {
    const messages = nextMessage.type === "USER_MESSAGE" ? ({
        type: "USER_MESSAGE",
        message: nextMessage.message,
    } as MimirHumanReplyMessage) : {
        type: "FUNCTION_REPLY",
        functionReply: {
            name: nextMessage.tool!,
            arguments: nextMessage.message,
        }
    } as MimirHumanReplyMessage;

    const message = nextMessage.type === "USER_MESSAGE" ? new HumanMessage(nextMessage.message) : new FunctionMessage(nextMessage.message, nextMessage.tool!);
    return {
        message: message,
        messageToSave: messages,
    };
};

export class FunctionCallAiMessageSerializer extends AiMessageSerializer {
    async deserialize(aiMessage: MimirAIMessage): Promise<BaseMessage> {
        const output = aiMessage as MimirAIMessage;
        const functionCall = output.functionCall ? {
            function_call: {
                name: output.functionCall?.name,
                arguments: output.functionCall?.arguments
            },
        } : {};
        const message = new AIMessage(output.text ?? "", {
            ...functionCall
        });
        return message;
    }
}

export class PlainTextHumanMessageSerializer extends HumanMessageSerializer {
    async deserialize(message: MimirHumanReplyMessage): Promise<BaseMessage> {
        if (message.type === "FUNCTION_REPLY") {
            return new FunctionMessage(message.functionReply?.arguments!, message.functionReply!.name);
        }
        return new HumanMessage(message.message!);
    }
}


const OPENAI_FUNCTION_AGENT_ATTRIBUTES: AttributeDescriptor[] = [
    {
        name: "Message To User",
        description: "Any message you want to send to the user. Useful when you want to present the answer to the request. Use it when you think that you are stuck or want to present the anwser to the user. This field must not be set at the same time as calling a function. ",
        variableName: "messageToUser",
        attributeType: "string",
    },
]


export function createOpenAiFunctionAgent(args: MimirAgentArgs) {

    if (args.llm._modelType() !== "base_chat_model" || args.llm._llmType() !== "openai") {
        throw new Error("This agent requires an OpenAI chat model");
    }

    const pluginAttributes = args.plugins.map(plugin => plugin.attributes()).flat();
    const formatManager = new ResponseFieldMapper([...DEFAULT_ATTRIBUTES, ...pluginAttributes, ...OPENAI_FUNCTION_AGENT_ATTRIBUTES]);

    const systemMessages = [
        SystemMessagePromptTemplate.fromTemplate(IDENTIFICATION(args.name, args.description)),
        SystemMessagePromptTemplate.fromTemplate(args.constitution),
        SystemMessagePromptTemplate.fromTemplate(formatManager.createFieldInstructions()),
        ...args.plugins.map(plugin => plugin.systemMessages()).flat(),
    ];

    const internalPlugins = args.plugins.map(plugin => {

        const agentPlugin: InternalAgentPlugin = {
            getInputs: (context) => plugin.getInputs(context),
            readResponse: async (context: AgentContext, response: MimirAIMessage) => {
                await plugin.readResponse(context, response, formatManager);
            },
            clear: async () => {
                await plugin.clear();
            }
        }
        return agentPlugin;
    });

    const chatHistory = new TransformationalChatMessageHistory(args.chatMemory, new FunctionCallAiMessageSerializer(), new PlainTextHumanMessageSerializer());
    const finalMemory = args.memoryBuilder(chatHistory);

    const agent = MimirAgent.fromLLMAndTools(args.llm, new AIMessageLLMOutputParser(), messageGenerator, {
        systemMessage: systemMessages,
        outputParser: new ChatConversationalAgentOutputParser(formatManager, args.taskCompleteCommandName, args.talkToUserTool?.name),
        taskCompleteCommandName: args.taskCompleteCommandName,
        memory: finalMemory,
        defaultInputs: {
            tools: args.plugins.map(plugin => plugin.tools()).flat(),
        },
        plugins: internalPlugins,
        name: args.name,
    });

    return agent;
}