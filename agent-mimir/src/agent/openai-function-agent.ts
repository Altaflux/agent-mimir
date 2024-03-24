import { MimirAgent, InternalAgentPlugin, MimirAIMessage } from "./base-agent.js";
import { AttributeDescriptor, ResponseFieldMapper } from "./instruction-mapper.js";
import { AIMessage, BaseMessage, FunctionMessage, HumanMessage } from "@langchain/core/messages";
import { AgentActionOutputParser, AgentFinish, AgentAction, } from "langchain/agents";
import { AgentContext, LLMImageHandler, MimirAgentArgs, NextMessage, AgentSystemMessage, AdditionalContent } from "../schema.js";
import { DEFAULT_ATTRIBUTES, IDENTIFICATION } from "./prompt.js";
import { AiMessageSerializer, HumanMessageSerializer, TransformationalChatMessageHistory } from "../memory/transform-memory.js";
import { callJsonRepair } from "../utils/json.js";
import { MimirToolToLangchainTool } from "../utils/wrapper.js";
import { BaseLLMOutputParser } from "@langchain/core/output_parsers";
import { ChatGeneration, Generation } from "@langchain/core/outputs";
import { ChainValues } from "@langchain/core/utils/types";
import { complexResponseToLangchainMessageContent } from "../utils/format.js";


type AIMessageType = {

    messageToSend?: string,
}
export class ChatConversationalAgentOutputParser extends AgentActionOutputParser {

    constructor(private responseFieldMapper: ResponseFieldMapper<AIMessageType>, private finishToolName: string, private talkToUserTool: string | undefined) {
        super();
    }

    lc_namespace = ["langchain", "agents", "output-parser"]

    async parse(input: string): Promise<AgentAction | AgentFinish> {
        const out1 = JSON.parse(input) as MimirAIMessage;

        let toolInput = '';
        try {
            toolInput = JSON.parse(out1.functionCall!.arguments);
        } catch (e) {
            toolInput = JSON.parse(callJsonRepair(out1.functionCall!.arguments));
        }
        const action = { tool: out1.functionCall!.name, toolInput: toolInput, log: input }
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


class AIMessageLLMOutputParser extends BaseLLMOutputParser<MimirAIMessage> {
    async parseResult(generations: Generation[] | ChatGeneration[]): Promise<MimirAIMessage> {
        const generation = generations[0] as ChatGeneration;
        let functionCall: any = undefined;
        let hasError = false;
        try {
            functionCall = (generation.message?.additional_kwargs?.tool_calls![0]).function;
            JSON.parse(callJsonRepair(functionCall?.arguments ?? undefined))
        } catch (e) {
            hasError = true;
        }
        const mimirMessage: MimirAIMessage = {
            functionCall: functionCall ? {
                name: functionCall?.name,
                arguments: (functionCall?.arguments),
            } : undefined,
            text: generation.text,
            error: hasError,
        }
        return mimirMessage;
    }
    lc_namespace: string[] = [];
}


function messageGeneratorBuilder(imageHandler: LLMImageHandler) {
    const messageGenerator: (nextMessage: NextMessage) => Promise<{ message: BaseMessage, }> = async (nextMessage: NextMessage) => {
        if (nextMessage.type === "USER_MESSAGE") {
            return {
                message: new HumanMessage({
                    content: complexResponseToLangchainMessageContent(nextMessage.content, imageHandler)
                })
            }
        } else {
            const toolResponse = nextMessage.content;
            const mimirFunctionMessage = {
                type: "FUNCTION_REPLY" as const,
                functionReply: {
                    name: nextMessage.tool!,
                    arguments: toolResponse,
                }
            }
            return {
                message: new FunctionMessage({
                    name: mimirFunctionMessage.functionReply.name,
                    content: complexResponseToLangchainMessageContent(toolResponse, imageHandler)
                })
            }
        }
    }
    return messageGenerator;
}



export class FunctionCallAiMessageSerializer extends AiMessageSerializer {
    async deserialize(aiMessage: MimirAIMessage): Promise<BaseMessage> {
        const output = aiMessage;
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
    constructor(private imageHandler: LLMImageHandler) {
        super();
    }
    async deserialize(message: NextMessage): Promise<BaseMessage> {
        if (message.type === "ACTION") {
            return new FunctionMessage({
                name: message.tool,
                content: complexResponseToLangchainMessageContent(message.content, this.imageHandler)
            });
        }
        return new HumanMessage({
            content: complexResponseToLangchainMessageContent(message.content, this.imageHandler)
        });
    }
}


const OPENAI_FUNCTION_AGENT_ATTRIBUTES: AttributeDescriptor[] = [

]


export async function createOpenAiFunctionAgent(args: MimirAgentArgs) {

    if (args.llm._modelType() !== "base_chat_model" || args.llm._llmType() !== "openai") {
        throw new Error("This agent requires an OpenAI chat model");
    }

    const pluginAttributes = args.plugins.map(plugin => plugin.attributes()).flat();
    const formatManager = new ResponseFieldMapper([...DEFAULT_ATTRIBUTES, ...pluginAttributes, ...OPENAI_FUNCTION_AGENT_ATTRIBUTES]);

    const systemMessages = {
        content: [
            {
                type: "text",
                text: IDENTIFICATION(args.name, args.description),
            },
            {
                type: "text",
                text: args.constitution,
            },
            {
                type: "text",
                text: formatManager.createFieldInstructions(),
            }
        ]
    } as AgentSystemMessage;

    const talkToUserTools = args.talkToUserTool ? [args.talkToUserTool] : [];

    const internalPlugins = args.plugins.map(plugin => {

        const agentPlugin: InternalAgentPlugin = {
            getSystemMessages: async (context) => await plugin.getSystemMessages(context),
            readResponse: async (context: AgentContext, response: MimirAIMessage) => {
                await plugin.readResponse(context, response, formatManager);
            },
            clear: async () => {
                await plugin.clear();
            },
            additionalContent: async function (nextMessage: NextMessage, inputs: ChainValues): Promise<AdditionalContent[]> {
                return await plugin.additionalMessageContent(nextMessage, inputs);
            },
        }
        return agentPlugin;
    });

    const chatHistory = new TransformationalChatMessageHistory(args.chatMemory, new FunctionCallAiMessageSerializer(), new PlainTextHumanMessageSerializer(args.imageHandler));
    const finalMemory = args.memoryBuilder({
        messageHistory: chatHistory,
        plainText: false,
    });


    const agent = MimirAgent.fromLLMAndTools(args.llm, new AIMessageLLMOutputParser(), messageGeneratorBuilder(args.imageHandler), args.imageHandler, {
        systemMessage: systemMessages,
        outputParser: new ChatConversationalAgentOutputParser(formatManager, args.taskCompleteCommandName, args.talkToUserTool?.name),
        taskCompleteCommandName: args.taskCompleteCommandName,
        memory: finalMemory,
        resetFunction: args.resetFunction,
        defaultInputs: {
            tools: [...(await Promise.all(args.plugins.map(async plugin => await plugin.tools()))).flat(), ...talkToUserTools].map(tool => new MimirToolToLangchainTool(tool)),
        },
        plugins: internalPlugins,
    });

    return agent;
}