import { BaseLanguageModel } from "langchain/base_language";
import { BaseLLMOutputParser } from "langchain/schema/output_parser";
import { Gpt4FunctionAgent, MimirAIMessage, NextMessage } from "./base-agent.js";
import { AIChatMessage, AgentAction, AgentFinish, BaseChatMessage, ChatGeneration, FunctionChatMessage, Generation, HumanChatMessage } from "langchain/schema";
import { AiMessageSerializer, DefaultHumanMessageSerializerImp } from "../parser/plain-text-parser/index.js";
import { PromptTemplate, SystemMessagePromptTemplate, renderTemplate } from "langchain/prompts";
import { AttributeDescriptor, ResponseFieldMapper } from "./instruction-mapper.js";

import { AgentActionOutputParser } from "langchain/agents";
import { BaseChatMemory } from "langchain/memory";
import { StructuredTool } from "langchain/tools";
import { zodToJsonSchema } from "zod-to-json-schema";
import { JsonSchema7ObjectType } from "zod-to-json-schema/src/parsers/object.js";

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


const JSON_INSTRUCTIONS = `You must format your inputs to these commands to match their "JSON schema" definitions below.
"JSON Schema" is a declarative language that allows you to annotate and validate JSON documents.
For example, the example "JSON Schema" instance {"properties": {"foo": {"description": "a list of test words", "type": "array", "items": {"type": "string"}}}, "required": ["foo"]}}
would match an object with one required property, "foo". The "type" property specifies "foo" must be an "array", and the "description" property semantically describes it as "a list of test words". The items within "foo" must be strings.
Thus, the object {"foo": ["bar", "baz"]} is a well-formatted instance of this example "JSON Schema". The object {"properties": {"foo": ["bar", "baz"]}} is not well-formatted.`

const SUFFIX = `\nCOMMANDS
------
You can use the following commands to look up information that may be helpful in answering the users original question or interact with the user.


{json_instructions}

The commands with their JSON schemas you can use are:
{toolList}

`;

const USER_INPUT = `USER'S INPUT
--------------------
Here is the user's input (remember to respond with using the format instructions above):

{input}`;

const TEMPLATE_TOOL_RESPONSE = `COMMAND RESPONSE, (Note from user: I cannot see the command response, any information from the command response you must tell me explicitly): 
---------------------
{observation}

USER'S INPUT
--------------------
Modify the current plan as needed to achieve my request and proceed with it. 

`;

type AIMessageType = {
    functionName?: string,
    functionArguments?: string,
}
export class ChatConversationalAgentOutputParser extends AgentActionOutputParser {

    constructor(private responseThing: ResponseFieldMapper<AIMessageType>, private finishToolName: string) {
        super();
    }

    lc_namespace = ["langchain", "agents", "output-parser"]

    async parse(input: string): Promise<AgentAction | AgentFinish> {
        const out1 = JSON.parse(input) as MimirAIMessage;
        let out = {} as AIMessageType;
        if (out1.text && out1.text.length !== 0) {
            out = await this.responseThing.readInstructionsFromResponse(out1.text);
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
    constructor(private responseThing: ResponseFieldMapper<AIMessageType>) {
        super();
    }
    async parseResult(generations: Generation[] | ChatGeneration[]): Promise<MimirAIMessage> {
        const generation = generations[0] as ChatGeneration;
        const aiMessage = await this.responseThing.readInstructionsFromResponse(generation.text);
        const mimirMessage = {
            functionCall: aiMessage.functionName ? {
                name: aiMessage.functionName,
                arguments: aiMessage.functionArguments!,
            } : undefined,
            text: generation.text,
        }
        return mimirMessage;
    }
    lc_namespace: string[] = [];

}

const messageGenerator: (nextMessage: NextMessage) => Promise<{ message: BaseChatMessage, messageToSave: BaseChatMessage, }> = async (nextMessage: NextMessage) => {
    if (nextMessage.type === "USER_MESSAGE") {
        const renderedHumanMessage = renderTemplate(USER_INPUT, "f-string", {
            input: nextMessage.message,
        });
        return {
            message: new HumanChatMessage(renderedHumanMessage),
            messageToSave: new HumanChatMessage(nextMessage.message),
        };
    } else {
        const renderedHumanMessage = renderTemplate(TEMPLATE_TOOL_RESPONSE, "f-string", {
            observation: nextMessage.message,
        });
        return {
            message: new HumanChatMessage(renderedHumanMessage),
            messageToSave: new HumanChatMessage(nextMessage.message),
        };
    }

};




export class DefaultAiMessageSerializer extends AiMessageSerializer {
    // constructor(private fieldMapper: ResponseFieldMapper<AIMessageType>) { 
    //     super(); 
    // }

    async serialize(aiMessage: any): Promise<string> {
        const output = aiMessage as MimirAIMessage;
        const message = new AIChatMessage(output.text ?? "");
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
        name: "Command",
        description: "\\ The command to run. This field is obligatory.",
        variableName: "functionName",
        example: "someCommand"
    },
    {
        name: "Command JSON",
        description: "\\ Command JSON goes here, the input to the command. This field is obligatory.",
        variableName: "functionArguments",
        example: JSON.stringify({ someInput: "someValue" })
    },
]


export type DefaultMimirAgentArgs = {
    name: string,
    llm: BaseLanguageModel,
    memory: BaseChatMemory
    taskCompleteCommandName: string,
    talkToUserTool: StructuredTool,
    tools: StructuredTool[]
}
export function createDefaultMimirAgent(args: DefaultMimirAgentArgs) {

    const formatManager = new ResponseFieldMapper(atts);

    const toolsSystemMessage = new SystemMessagePromptTemplate(
        new PromptTemplate({
            template: SUFFIX,
            inputVariables: [],
            partialVariables: {
                toolList: createToolSchemasString([...args.tools, args.talkToUserTool]),
                tool_names: [...args.tools, args.talkToUserTool].map((tool) => tool.name).join(", "),
                json_instructions: JSON_INSTRUCTIONS,
            },
        })
    );
    const systemMessages = [
        SystemMessagePromptTemplate.fromTemplate(PREFIX_JOB(args.name, "an Assistant")),
        SystemMessagePromptTemplate.fromTemplate(formatManager.createFieldInstructions()),
        toolsSystemMessage,
    ];


    const agent = Gpt4FunctionAgent.fromLLMAndTools(args.llm, new AIMessageLLMOutputParser(formatManager), messageGenerator, {
        systemMessage: systemMessages,
        outputParser: new ChatConversationalAgentOutputParser(formatManager, args.taskCompleteCommandName),
        taskCompleteCommandName: args.taskCompleteCommandName,
        memory: args.memory,
        defaultInputs: {

        },
        aiMessageSerializer: new DefaultAiMessageSerializer(),
        humanMessageSerializer: new DefaultHumanMessageSerializerImp(),
    });

    return agent;

}


function createToolSchemasString(tools: StructuredTool[]) {
    return tools
        .map(
            (tool) =>
                `${tool.name}: ${tool.description}, args: ${JSON.stringify(
                    (zodToJsonSchema(tool.schema) as JsonSchema7ObjectType).properties
                )}`
        )
        .join("\n");
}