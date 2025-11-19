import {
    ToolMessage,
    BaseMessage,
    isAIMessage,
} from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";

import { MessagesAnnotation } from "@langchain/langgraph";
import { complexResponseToLangchainMessageContent, extractAllTextFromComplexResponse } from "../../utils/format.js";

export type ToolNodeOptions = {
    name?: string;
    tags?: string[];
    handleToolErrors?: boolean;
};
import WebSocket from 'ws';
import { AgentTool, ToolResponse } from "../../tools/index.js";
import { ComplexMessageContent } from "../../schema.js";
import { v4 } from "uuid";
import { CodeToolExecutor } from "./index.js";

export type ToolOutput = {
    tool_name: string,
    response: ToolResponse,
}


export const pythonToolNodeFunction = (
    tools: (AgentTool)[],
    executor: CodeToolExecutor,
    options?: ToolNodeOptions) => {


    return async (input: typeof MessagesAnnotation.State, config: RunnableConfig) => {
        const message: BaseMessage = Array.isArray(input)
            ? input[input.length - 1]
            : input.messages[input.messages.length - 1];

        if (!message || !isAIMessage(message) || !(message.tool_calls ?? []).find(t => t.name === "CODE_EXECUTION")) {
            throw new Error("ToolNode only accepts AIMessages as input with CODE_EXECUTION tool call.");
        }

        const toolCall = (message.tool_calls ?? []).find(t => t.name === "CODE_EXECUTION")!;
        const pythonScript: string = toolCall.args["script"]!;
        const libraries: string[] = toolCall.args["libraries"]!;

        const toolResponses = new Map<string, ToolOutput>();

        const result = await executor.execute(tools, pythonScript, libraries, (wsUrl, tools) => {
            toolHandler(wsUrl, tools, toolResponses)
        });

        const messageContent = splitByToolResponse(result)
            .map((part) => {
                const toolResponseId = extractToolResponseIdRegex(part);
                if (toolResponseId) {
                    const toolResponse = toolResponses.get(toolResponseId)!;
                    if (toolResponse) {
                        return toolResponse.response;
                    } else {
                        return [{
                            type: "text",
                            text: `((Tool response with ID ${toolResponseId} not found.))`,
                        } satisfies ComplexMessageContent]
                    }
                } else {
                    return [
                        {
                            type: "text",
                            text: part,
                        } satisfies ComplexMessageContent
                    ];
                }
            }).flatMap((e) => e);

        const userMesage = new ToolMessage({
            id: v4(),
            tool_call_id: toolCall.id ?? v4(),
            content: complexResponseToLangchainMessageContent([
                {
                    type: "text",
                    text: "Result from script execution:\n\n",
                },
                ...messageContent
            ])
        })

        // Handle mixed Command and non-Command outputs

        return { messages: [userMesage], };
    }
};



export async function toolHandler(url: string, tools: AgentTool[], toolResponses: Map<string, ToolOutput>) {
    let ws = new WebSocket(url, { perMessageDeflate: false });
    ws.on('open', function open(dc: any, f: any) {
        ws.on('message', async function (data: any) {
            const msg_options: Parameters<WebSocket["send"]>[1] = {}
            if (data instanceof ArrayBuffer) {
                msg_options.binary = true

                data = Buffer.from(data).toString()
            }

            const parsedData = JSON.parse(data as string) as PythonFunctionRequest
            const tool = tools.find((tool) => tool.name === parsedData.request.method)!;

            let actualOutput;
            let error = false;
            try {
                let output = await tool.invoke(
                    parsedData.request.arguments,

                );
                actualOutput = output as any;
                if (tool.outSchema) {
                    actualOutput = JSON.parse(extractAllTextFromComplexResponse(output as ComplexMessageContent[]));
                } else {
                    actualOutput = `<<TOOL_RESPONSE:${parsedData.request.call_id}>>`;
                    toolResponses.set(parsedData.request.call_id, {
                        tool_name: parsedData.request.method,
                        response: output,
                    });
                }
                error = false;
            } catch (e) {
                error = true;
                actualOutput = typeof e === "string" ? e : JSON.stringify(e);
            }

            ws.send(JSON.stringify({
                response: {
                    jsonrpc: "2.0",
                    result: {
                        error: error,
                        value: actualOutput
                    },
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


