import { BaseLanguageModel } from "langchain/base_language";
import { BaseLLMOutputParser } from "langchain/schema/output_parser";
import { Gpt4FunctionAgent, MimirAIMessage, NextMessage } from "./base-agent.js";
import { AIChatMessage, AgentAction, AgentFinish, BaseChatMessage, ChatGeneration, FunctionChatMessage, Generation, HumanChatMessage } from "langchain/schema";
import { AiMessageSerializer, HumanMessageSerializer, DefaultHumanMessageSerializerImp } from "../parser/plain-text-parser/index.js";
import { SystemMessagePromptTemplate } from "langchain/prompts";
import { AttributeDescriptor, ResponseFieldMapper } from "./instruction-mapper.js";

import { AgentActionOutputParser } from "langchain/agents";
import { BaseChatMemory } from "langchain/memory";
import { StructuredTool } from "langchain/tools";


const PREFIX_JOB = (name: string, jobDescription: string) => {
    return `Your name is ${name}, a large language model. Carefully heed the user's instructions. I want you to act as ${jobDescription}.

PERFORMANCE EVALUATION:

1. Continuously review and analyze your plan and commands to ensure you are performing to the best of your abilities. 
2. Constructively self-criticize your big-picture behavior constantly.
3. Reflect on past decisions and strategies to refine your approach.
4. Do not procrastinate. Try to complete the task and don't simply respond that you will do the task. If you are unsure of what to do, ask the user for help.
5. Do not simulate that you are working.
6. Talk to the user the least amount possible. Only to present the answer to any request or task.


When working on a task you have to choose between this two options: 
- Use your own knowledge, capabilities, and skills to complete the task.
- If you cannot accomplish the task with your own knowledge or capabilities use a command.

`;
};



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

        //TODO HACK!
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


class AIMessageLLMOutputParser extends BaseLLMOutputParser<MimirAIMessage> {
    async parseResult(generations: Generation[] | ChatGeneration[]): Promise<MimirAIMessage> {
        const generation = generations[0] as ChatGeneration;
        const functionCall: any = generation.message?.additional_kwargs?.function_call
        const mimirMessage =  {
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

const messageGenerator: (nextMessage: NextMessage) => Promise<{ message: BaseChatMessage, messageToSave: BaseChatMessage, }> = async (nextMessage: NextMessage) => {
    const message = nextMessage.type === "USER_MESSAGE" ? new HumanChatMessage(nextMessage.message) : new FunctionChatMessage(nextMessage.message, nextMessage.tool!);
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
        const message = new AIChatMessage(output.text ?? "", {
            ...functionCall
        });
        const serializedMessage = message.toJSON();
        return JSON.stringify(serializedMessage);
    }
}
const atts: AttributeDescriptor[] = [
    {
        name: "Thoughts",
        description: "string \\ Any observation or thought about the task",
        variableName: "thoughts",
        example: "I can come up with an innovative solution to this problem."
    },
    {
        name: "Reasoning",
        description: "string \\ Reasoning for the plan",
        variableName: "reasoning",
        example: "I have introduced an unexpected twist, and now I need to continue with the plan."
    },
    {
        name: "Plan",
        description: "\\ An JSON array of strings representing the text of the plan of pending tasks needed to complete the user's request. This field is obligatory but can be empty.",
        variableName: "plan",
        example: `["Think of a better solution to the problem", "Ask the user for his opinion on the solution", "Work on the solution", "Present the answer to the user"]`
    },
    {
        name: "Current Plan Step",
        description: "\\ An JSON array of strings representing the text of the plan of pending tasks needed to complete the user's request. This field is obligatory but can be empty.",
        variableName: "currentPlanStep",
        example: "Think of a better solution to the problem"
    },
    {
        name: "Goal Given By User",
        description: "string \\ What is the main goal the user has tasked you with. If the user has made a change in your task then please update this field to reflect the change.",
        variableName: "goalGivenByUser",
        example: "Find a solution to the problem."
    },
    {
        name: "Save To ScratchPad",
        description: "string, \\ Any important piece of information you may be able to use later. This field is optional. ",
        variableName: "scratchPad",
        example: "The plot of the story is about a young kid going on an adventure to find his lost dog."
    },
    {
        name: "Message To User",
        description: "\\ Any message you want to send to the user. Useful when you want to present the answer to the request. Use it when you think that you are stuck or want to present the anwser to the user. This field must not be set at the same time as calling a function. ",
        variableName: "messageToUser"
    },
]

export type OpenAIFunctionMimirAgentArgs = {
    name: string,
    llm: BaseLanguageModel,
    memory: BaseChatMemory
    taskCompleteCommandName: string,
    talkToUserCommandName?: string,
    tools: StructuredTool[]
}
export function createOpenAiFunctionAgent(args: OpenAIFunctionMimirAgentArgs) {

    const formatManager = new ResponseFieldMapper(atts);
    const systemMessages = [
        SystemMessagePromptTemplate.fromTemplate(PREFIX_JOB(args.name, "an Assistant")),
        SystemMessagePromptTemplate.fromTemplate(formatManager.createFieldInstructions()),
    ];


    const agent = Gpt4FunctionAgent.fromLLMAndTools(args.llm, new AIMessageLLMOutputParser(), messageGenerator, {
        systemMessage: systemMessages,
        outputParser: new ChatConversationalAgentOutputParser(formatManager, args.taskCompleteCommandName, args.talkToUserCommandName),
        taskCompleteCommandName: args.taskCompleteCommandName,
        memory: args.memory,
        defaultInputs: {
            tools: args.tools
        },
        aiMessageSerializer: new FunctionCallAiMessageSerializer(),
        humanMessageSerializer: new DefaultHumanMessageSerializerImp(),
    });

    return agent;
}