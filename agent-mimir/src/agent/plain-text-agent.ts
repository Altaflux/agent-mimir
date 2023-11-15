import { BaseLLMOutputParser } from "langchain/schema/output_parser";
import { MimirAgent, InternalAgentPlugin, MimirAIMessage } from "./base-agent.js";
import { AIMessage, AgentAction, AgentFinish, BaseMessage, BaseMessageFields, ChainValues, ChatGeneration, FunctionMessageFieldsWithName, Generation, HumanMessage } from "langchain/schema";
import { AiMessageSerializer, HumanMessageSerializer, TransformationalChatMessageHistory } from "../memory/transform-memory.js";
import { PromptTemplate, SystemMessagePromptTemplate, renderTemplate } from "langchain/prompts";
import { AttributeDescriptor, ResponseFieldMapper } from "./instruction-mapper.js";

import { AgentActionOutputParser } from "langchain/agents";
import { AgentContext, MimirAgentArgs, MimirHumanReplyMessage, MimirToolResponse, NextMessage } from "../schema.js";
import { DEFAULT_ATTRIBUTES, IDENTIFICATION } from "./prompt.js";
import { callJsonRepair } from "../utils/json.js";
import { renderTextDescriptionAndArgs } from "langchain/tools/render";
import { openAIImageHandler } from "../vision/index.js";
import { InnerToolWrapper } from "../utils/wrapper.js";


const JSON_INSTRUCTIONS = `You must format your inputs to these functions to match their "JSON schema" definitions below.
"JSON Schema" is a declarative language that allows you to annotate and validate JSON documents.
For example, the example "JSON Schema" instance {"properties": {"foo": {"description": "a list of test words", "type": "array", "items": {"type": "string"}}}, "required": ["foo"]}}
would match an object with one required property, "foo". The "type" property specifies "foo" must be an "array", and the "description" property semantically describes it as "a list of test words". The items within "foo" must be strings.
Thus, the object {"foo": ["bar", "baz"]} is a well-formatted instance of this example "JSON Schema". The object {"properties": {"foo": ["bar", "baz"]}} is not well-formatted.`

const SUFFIX = `\nFUNCTIONS
------
You can use the following functions to look up information that may be helpful in completing the users request or interact with the user.


{json_instructions}

The functions and the JSON schemas of their argument you can use are:
{toolList}

`;

const USER_INPUT = `USER'S INPUT
--------------------
Here is the user's input (remember to respond with using the format instructions above):

{input}`;

const TEMPLATE_TOOL_RESPONSE = `FUNCTION RESPONSE, (Note from user: I cannot see the function's response, any information from the function's response you must tell me explicitly): 
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
        let toolInput = undefined;
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
    constructor(private responseThing: ResponseFieldMapper<AIMessageType>) {
        super();
    }
    async parseResult(generations: Generation[] | ChatGeneration[]): Promise<MimirAIMessage> {
        const generation = generations[0] as ChatGeneration;
        const aiMessage = await this.responseThing.readInstructionsFromResponse(generation.text);
        let hasError = false;
        try {
            JSON.parse(callJsonRepair(aiMessage.functionArguments!))
        } catch (e) {
            hasError = true;
        }
        const mimirMessage = {
            error: hasError,
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



function messageGeneratorBuilder() {

    const messageGenerator: (nextMessage: NextMessage) => Promise<{ message: BaseMessage, messageToSave: MimirHumanReplyMessage, }> = async (nextMessage: NextMessage) => {

        if (nextMessage.type === "USER_MESSAGE") {
            const renderedHumanMessage = renderTemplate(USER_INPUT, "f-string", {
                input: nextMessage.message,
            });
            return {
                message: new HumanMessage({
                    content: [
                        {
                            type: "text",
                            text: renderedHumanMessage,
                        },
                        ...openAIImageHandler(nextMessage.image_url ?? [], "high"),
                    ]
                }),
                messageToSave: {
                    type: "USER_MESSAGE",
                    message: nextMessage.message,
                    image_url: nextMessage.image_url
                },
            };
        } else {
            const toolResponse = convert(nextMessage.message);
            return {
                message: new HumanMessage(extractToolResponse(toolResponse)),
                messageToSave: {
                    type: "USER_MESSAGE",
                    message: toolResponse.text ?? "",
                    image_url: toolResponse.image_url,
                },
            };
        }

    };
    return messageGenerator;
}

function convert(toolResponse: string): MimirToolResponse {
    return JSON.parse(toolResponse) as MimirToolResponse
}

function extractToolResponse(toolResponse: MimirToolResponse): BaseMessageFields {

    const stuff: BaseMessageFields = {
        content: [
            {
                type: "text",
                text: renderTemplate(TEMPLATE_TOOL_RESPONSE, "f-string", {
                    observation: toolResponse.text ?? "",
                })
            },
            ...openAIImageHandler(toolResponse.image_url ?? [], "high"),
        ]
    }
    return stuff as FunctionMessageFieldsWithName;
}
export class DefaultAiMessageSerializer extends AiMessageSerializer {
    async deserialize(mimirMessage: MimirAIMessage): Promise<BaseMessage> {
        return new AIMessage(mimirMessage.text ?? "");
    }
}
export class PlainTextHumanMessageSerializer extends HumanMessageSerializer {
    async deserialize(message: MimirHumanReplyMessage): Promise<BaseMessage> {
        return new HumanMessage({
            content: [
                {
                    type: "text",
                    text: message.message ?? "",
                },
                ...openAIImageHandler(message.image_url ?? [], "high"),
            ]
        });
    }
}

const PLAIN_TEXT_AGENT_ATTRIBUTES: AttributeDescriptor[] = [

    {
        name: "Function Name",
        description: "The name of the function to run. This field is obligatory.",
        example: "someFunction",
        variableName: "functionName",
        attributeType: "string",
    },
    {
        name: "Function Argument",
        description: "Function's JSON argument goes here. This field is obligatory.",
        example: "{" + JSON.stringify({ someInput: "someValue" }) + "}",
        variableName: "functionArguments",
        attributeType: "JSON",
    },
]



export function createPlainTextMimirAgent(args: MimirAgentArgs) {

    const pluginAttributes = args.plugins.map(plugin => plugin.attributes()).flat();
    const formatManager = new ResponseFieldMapper([...DEFAULT_ATTRIBUTES, ...pluginAttributes, ...PLAIN_TEXT_AGENT_ATTRIBUTES]);

    const internalPlugins = args.plugins.map(plugin => {
        const agentPlugin: InternalAgentPlugin = {
            getInputs: (context) => plugin.getInputs(context),
            readResponse: async (context: AgentContext, response: MimirAIMessage) => {
                await plugin.readResponse(context, response, formatManager);
            },
            clear: async () => {
                await plugin.clear();
            },
            processMessage: async function (nextMessage: NextMessage, inputs: ChainValues): Promise<NextMessage | undefined> {
                return await plugin.processMessage(nextMessage, inputs);
            }
        }
        return agentPlugin;
    });

    const tools = args.plugins.map(plugin => plugin.tools()).flat();
    const talkToUserTools = args.talkToUserTool ? [args.talkToUserTool] : [];
    const toolsSystemMessage = new SystemMessagePromptTemplate(
        new PromptTemplate({
            template: SUFFIX,
            inputVariables: [],
            partialVariables: {
                toolList: renderTextDescriptionAndArgs([...tools, ...talkToUserTools].map(tool => new InnerToolWrapper(tool))),
                tool_names: [...tools, ...talkToUserTools].map((tool) => tool.name).join(", "),
                json_instructions: JSON_INSTRUCTIONS,
            },
        })
    );
    const systemMessages = [
        SystemMessagePromptTemplate.fromTemplate(IDENTIFICATION(args.name, args.description)),
        SystemMessagePromptTemplate.fromTemplate(args.constitution),
        SystemMessagePromptTemplate.fromTemplate(formatManager.createFieldInstructions()),
        ...args.plugins.map(plugin => plugin.systemMessages()).flat(),
        toolsSystemMessage,
    ];

    const chatHistory = new TransformationalChatMessageHistory(args.chatMemory, new DefaultAiMessageSerializer(), new PlainTextHumanMessageSerializer());
    const finalMemory = args.memoryBuilder({
        messageHistory: chatHistory,
        plainText: true,
    });
    const agent = MimirAgent.fromLLMAndTools(args.llm, new AIMessageLLMOutputParser(formatManager), messageGeneratorBuilder(), {
        systemMessage: systemMessages,
        outputParser: new ChatConversationalAgentOutputParser(formatManager, args.taskCompleteCommandName),
        taskCompleteCommandName: args.taskCompleteCommandName,
        memory: finalMemory,
        resetFunction: args.resetFunction,
        defaultInputs: {

        },
        plugins: internalPlugins
    });

    return agent;

}
