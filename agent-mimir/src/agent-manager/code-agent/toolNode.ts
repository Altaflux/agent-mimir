import {
    BaseMessage,
    ToolMessage,
    AIMessage,
    isBaseMessage,
    MessageContentComplex,
    HumanMessage,
} from "@langchain/core/messages";
import { RunnableConfig, RunnableToolLike } from "@langchain/core/runnables";
import { StructuredToolInterface } from "@langchain/core/tools";
// import { RunnableCallable } from "../utils.js";

//import { isGraphInterrupt } from "../errors.js";
//   import { isCommand } from "../constants.js";

import { Annotation, Command, END, interrupt, isCommand, isGraphInterrupt, Messages, MessagesAnnotation, messagesStateReducer, Send, START, StateDefinition, StateGraph, } from "@langchain/langgraph";
import { complexResponseToLangchainMessageContent, extractAllTextFromComplexResponse, extractTextContent } from "../../utils/format.js";
import { getExecutionCodeContentRegex } from "./utils.js";
import { localPythonEnvironment } from "./localPythonEnv.js";
export type ToolNodeOptions = {
    name?: string;
    tags?: string[];
    handleToolErrors?: boolean;
};
import WebSocket from 'ws';
import { AgentTool, ToolResponse } from "../../tools/index.js";
import { ComplexMessageContent } from "../../schema.js";
import { v4 } from "uuid";


export type ToolOutput = {
    tool_name: string,
    response: ToolResponse,
}


/**
 * A node that runs the tools requested in the last AIMessage. It can be used
 * either in StateGraph with a "messages" key or in MessageGraph. If multiple
 * tool calls are requested, they will be run in parallel. The output will be
 * a list of ToolMessages, one for each tool call.
 *
 * @example
 * ```ts
 * import { ToolNode } from "@langchain/langgraph/prebuilt";
 * import { tool } from "@langchain/core/tools";
 * import { z } from "zod";
 * import { AIMessage } from "@langchain/core/messages";
 *
 * const getWeather = tool((input) => {
 *   if (["sf", "san francisco"].includes(input.location.toLowerCase())) {
 *     return "It's 60 degrees and foggy.";
 *   } else {
 *     return "It's 90 degrees and sunny.";
 *   }
 * }, {
 *   name: "get_weather",
 *   description: "Call to get the current weather.",
 *   schema: z.object({
 *     location: z.string().describe("Location to get the weather for."),
 *   }),
 * });
 *
 * const tools = [getWeather];
 * const toolNode = new ToolNode(tools);
 *
 * const messageWithSingleToolCall = new AIMessage({
 *   content: "",
 *   tool_calls: [
 *     {
 *       name: "get_weather",
 *       args: { location: "sf" },
 *       id: "tool_call_id",
 *       type: "tool_call",
 *     }
 *   ]
 * })
 *
 * await toolNode.invoke({ messages: [messageWithSingleToolCall] });
 * // Returns tool invocation responses as:
 * // { messages: ToolMessage[] }
 * ```
 *
 * @example
 * ```ts
 * import {
 *   StateGraph,
 *   MessagesAnnotation,
 * } from "@langchain/langgraph";
 * import { ToolNode } from "@langchain/langgraph/prebuilt";
 * import { tool } from "@langchain/core/tools";
 * import { z } from "zod";
 * import { ChatAnthropic } from "@langchain/anthropic";
 *
 * const getWeather = tool((input) => {
 *   if (["sf", "san francisco"].includes(input.location.toLowerCase())) {
 *     return "It's 60 degrees and foggy.";
 *   } else {
 *     return "It's 90 degrees and sunny.";
 *   }
 * }, {
 *   name: "get_weather",
 *   description: "Call to get the current weather.",
 *   schema: z.object({
 *     location: z.string().describe("Location to get the weather for."),
 *   }),
 * });
 *
 * const tools = [getWeather];
 * const modelWithTools = new ChatAnthropic({
 *   model: "claude-3-haiku-20240307",
 *   temperature: 0
 * }).bindTools(tools);
 *
 * const toolNodeForGraph = new ToolNode(tools)
 *
 * const shouldContinue = (state: typeof MessagesAnnotation.State) => {
 *   const { messages } = state;
 *   const lastMessage = messages[messages.length - 1];
 *   if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls?.length) {
 *     return "tools";
 *   }
 *   return "__end__";
 * }
 *
 * const callModel = async (state: typeof MessagesAnnotation.State) => {
 *   const { messages } = state;
 *   const response = await modelWithTools.invoke(messages);
 *   return { messages: response };
 * }
 *
 * const graph = new StateGraph(MessagesAnnotation)
 *   .addNode("agent", callModel)
 *   .addNode("tools", toolNodeForGraph)
 *   .addEdge("__start__", "agent")
 *   .addConditionalEdges("agent", shouldContinue)
 *   .addEdge("tools", "agent")
 *   .compile();
 *
 * const inputs = {
 *   messages: [{ role: "user", content: "what is the weather in SF?" }],
 * };
 *
 * const stream = await graph.stream(inputs, {
 *   streamMode: "values",
 * });
 *
 * for await (const { messages } of stream) {
 *   console.log(messages);
 * }
 * // Returns the messages in the state at each step of execution
 * ```
 */

export const pythonToolNodeFunction = (
    tools: (AgentTool)[],
    options?: ToolNodeOptions) => {

    return async (input: typeof MessagesAnnotation.State, config: RunnableConfig) => {
        const message = Array.isArray(input)
            ? input[input.length - 1]
            : input.messages[input.messages.length - 1];

        if (message?._getType() !== "ai") {
            throw new Error("ToolNode only accepts AIMessages as input.");
        }


        const textConent = extractTextContent(message.content);
        const pythonScript = getExecutionCodeContentRegex(textConent)!;

        const toolResponses = new Map<string, ToolOutput>();
        const result = await localPythonEnvironment(9000, tools.map(tool => tool.name), pythonScript, () => {
            toolHandler(9000, tools, toolResponses)
         })

        const messageContent = splitByToolResponse(result)
            .map((part) => {
                const toolResponseId = extractToolResponseIdRegex(part);
                if (toolResponseId) {
                    const toolResponse = toolResponses.get(toolResponseId)!;
                    if (toolResponse) {
                        const resp: MessageContentComplex[] = complexResponseToLangchainMessageContent(toolResponse.response as ComplexMessageContent[]);
                        return resp;
                    } else {
                        return [ {
                            type: "text",
                            text: `((Tool response with ID ${toolResponseId} not found.))`,
                        }]
                    }
                } else {
                    return [
                        {
                            type: "text",
                            text: part,
                        }
                    ];
                }
            }).flatMap((e) => e);
        const userMesage = new HumanMessage({
            response_metadata:{
                toolMessage: true,
            },
            id: v4(),
            content: [
                {
                    type: "text",
                    text: "Result from script execution:\n\n",
                },
                ...messageContent
            ],
        })

        // Handle mixed Command and non-Command outputs

        return {messages: [userMesage],} ;
    }
};



export async function toolHandler(port: number, tools: AgentTool[], toolResponses: Map<string, ToolOutput>) {

    let ws = new WebSocket(`ws://localhost:${port}/ws`, { perMessageDeflate: false });
    ws.on('open', function open(dc: any, f: any) {
        ws.on('message', async function (data: any) {
            console.log('Received message:', data);
            const msg_options: Parameters<WebSocket["send"]>[1] = {}
            if (data instanceof ArrayBuffer) {
                msg_options.binary = true

                data = Buffer.from(data).toString()
            }

            const parsedData = JSON.parse(data as string) as PythonFunctionRequest

            console.log("Parsed data:", parsedData)

            const tool = tools.find((tool) => tool.name === parsedData.request.method)!;

            let output = await tool.invoke(
                parsedData.request.arguments,

            );
            let actualOutput = output as any;
            if (tool.outSchema) {
                actualOutput = tool.outSchema.parse(extractAllTextFromComplexResponse(output as ComplexMessageContent[]));
            } else {
                actualOutput = `<<TOOL_RESPONSE:${parsedData.request.call_id}>>`;
                toolResponses.set(parsedData.request.call_id, {
                    tool_name: parsedData.request.method,
                    response: output,
                });
            }
            
            ws.send(JSON.stringify({
                response: {
                    jsonrpc: "2.0",
                    result: actualOutput,
                    result_type: null,
                    call_id: parsedData.request.call_id,
                },
            }), msg_options)
        })
    });

    ws.on('close', function (event) {
        console.log('WebSocket closed:', event);
    });
}

type PythonFunctionRequest = {
    request: {
        method: string;
        arguments: Object;
        call_id: string;
    }
}



function splitByToolResponse(text: string) {
    if (typeof text !== 'string' || text === null) {
      console.error("Input must be a non-null string.");
      return []; // Or throw an error, depending on desired behavior
    }
  
    // The regex:
    // (          )- Start capturing group
    // <<TOOL_RESPONSE: - Match the literal starting part of the marker
    // [^>]+      - Match one or more characters that are NOT '>' (this captures the ID)
    // >>         - Match the literal ending part of the marker
    // )          - End capturing group
    const regex = /(<<TOOL_RESPONSE:[^>]+>>)/;
  
    // Split the string using the regex. Because of the capturing group,
    // the matched delimiters (the <<TOOL_RESPONSE:...>> parts) will be included.
    const parts = text.split(regex);
  
    // The split operation might leave empty strings in the array,
    // for example, if a marker is at the very beginning or end of the string,
    // or if two markers are adjacent. We filter these out.
    const filteredParts = parts.filter(part => part !== '');
  
    return filteredParts;
  }
function extractToolResponseIdRegex(markerString: string) {
    if (typeof markerString !== 'string' || markerString === null) {
      return null; // Ensure input is a string
    }
  
    // Regex breakdown:
    // ^                 - Anchors the match to the start of the string.
    // <<TOOL_RESPONSE: - Matches the literal prefix.
    // (               - Starts a capturing group (this is what we want to extract).
    //   [^>]+         - Matches one or more characters that are NOT '>'. This captures the ID.
    // )               - Ends the capturing group.
    // >>                - Matches the literal suffix.
    // $                 - Anchors the match to the end of the string.
    const regex = /^<<TOOL_RESPONSE:([^>]+)>>$/;
    const match = markerString.match(regex);
  
    // If a match is found, the result is an array where:
    // match[0] is the full matched string (e.g., "<<TOOL_RESPONSE:abc123>>")
    // match[1] is the content of the first capturing group (e.g., "abc123")
    if (match && match[1]) {
      return match[1];
    } else {
      return null; // The string didn't match the expected format
    }
  }