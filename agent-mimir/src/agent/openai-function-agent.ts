import { BaseLLMOutputParser } from "langchain/schema/output_parser";
import { MimirAgent, InternalAgentPlugin, MimirAIMessage, NextMessage } from "./base-agent.js";
import { AIMessage, AgentAction, AgentFinish, BaseMessage, ChatGeneration, FunctionMessage, Generation, HumanMessage } from "langchain/schema";

import { SystemMessagePromptTemplate } from "langchain/prompts";
import { AttributeDescriptor, ResponseFieldMapper } from "./instruction-mapper.js";

import { AgentActionOutputParser } from "langchain/agents";
import { AgentContext, MimirAgentArgs } from "../schema.js";
import { DEFAULT_ATTRIBUTES, IDENTIFICATION } from "./prompt.js";
import { AiMessageSerializer, DefaultHumanMessageSerializerImp } from "../memory/transform-memory.js";


type AIMessageType = {

    messageToUser?: string,
}
export class ChatConversationalAgentOutputParser extends AgentActionOutputParser {

    constructor(private responseThing: ResponseFieldMapper<AIMessageType>, private finishToolName: string, private talkToUserTool: string | undefined) {
        super();
    }

    lc_namespace = ["langchain", "agents", "output-parser"]

    async parse(input: string): Promise<AgentAction | AgentFinish> {
        const out1 = JSON.parse(input) as MimirAIMessage;
        let out = {} as AIMessageType;
        if (out1.text && out1.text.length !== 0) {
            out = await this.responseThing.readInstructionsFromResponse(out1.text);
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

const messageGenerator: (nextMessage: NextMessage) => Promise<{ message: BaseMessage, messageToSave: BaseMessage, }> = async (nextMessage: NextMessage) => {
    const message = nextMessage.type === "USER_MESSAGE" ? new HumanMessage(nextMessage.message) : new FunctionMessage(nextMessage.message, nextMessage.tool!);
    return {
        message: message,
        messageToSave: message,
    };
};

export class FunctionCallAiMessageSerializer extends AiMessageSerializer {

    async serialize(aiMessage: any): Promise<string> {
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
        const serializedMessage = message.toDict();
        return JSON.stringify(serializedMessage);
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

    const agent = MimirAgent.fromLLMAndTools(args.llm, new AIMessageLLMOutputParser(), messageGenerator, {
        systemMessage: systemMessages,
        outputParser: new ChatConversationalAgentOutputParser(formatManager, args.taskCompleteCommandName, args.talkToUserTool?.name),
        taskCompleteCommandName: args.taskCompleteCommandName,
        memory: args.memory,
        defaultInputs: {
            tools: args.plugins.map(plugin => plugin.tools()).flat(),
        },
        aiMessageSerializer: new FunctionCallAiMessageSerializer(),
        humanMessageSerializer: new DefaultHumanMessageSerializerImp(),
        plugins: internalPlugins,
        name: args.name,
    });

    return agent;
}