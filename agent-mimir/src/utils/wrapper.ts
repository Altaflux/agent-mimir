import { AgentTool } from "../tools/index.js";
import { z } from "zod";
import { v4 } from "uuid";
import { AgentUserMessage, ComplexResponse, ToolResponse } from "../schema.js";
import { StructuredTool, ToolRunnableConfig } from "@langchain/core/tools";
import { complexResponseToLangchainMessageContent } from "./format.js";
import { Command } from "@langchain/langgraph";
import { ToolCall, ToolMessage } from "@langchain/core/messages/tool";
import { RunnableConfig } from "@langchain/core/runnables";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";

export class MimirToolToLangchainTool extends StructuredTool {

    schema = this.tool.schema;
    name: string = this.tool.name;
    description: string = this.tool.description;
    returnDirect: boolean = this.tool.returnDirect

    constructor(private tool: AgentTool) {
        super();
    }

    protected async _call(arg: z.input<this["schema"]>,  runManager?: CallbackManagerForToolRun, parentConfig?: ToolRunnableConfig): Promise<any> {
        const response = await this.tool.call(arg);
        const toolCallId = parentConfig?.toolCall?.id!
        if (isUserAgentMessage(response)) {
            return new Command({
                update: {
                    agentMessage: [new ToolMessage({
                        id: v4(),
                        name: parentConfig?.toolCall?.name!,
                        tool_call_id: toolCallId,
                        content: JSON.stringify(response)
                    })],
                }
            });
        }
        if ((response as any).rawResponse) {
            return (response as any).rawResponse;
        }
        return complexResponseToLangchainMessageContent(response as ComplexResponse[]);
    }
}

export function isUserAgentMessage(x: ToolResponse): x is AgentUserMessage {
    if ((x as any).message) {
        return true;
    }
    return false;
}

export class LangchainToolToMimirTool extends AgentTool {

    schema = this.tool.schema;
    name: string = this.tool.name;
    description: string = this.tool.description;
    returnDirect: boolean = this.tool.returnDirect;

    constructor(private tool: StructuredTool) {
        super();
    }

    protected async _call(arg: z.input<this["schema"]>): Promise<ToolResponse> {
        const response = await this.tool.invoke(arg);
        return {
            rawResponse: response
        }

    }
}