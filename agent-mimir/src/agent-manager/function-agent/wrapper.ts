import { AgentTool, ToolResponse } from "../../tools/index.js";
import { z } from "zod";
import { v4 } from "uuid";
import { ComplexMessageContent } from "../../schema.js";
import { StructuredTool, ToolRunnableConfig } from "@langchain/core/tools";
import { complexResponseToLangchainMessageContent } from "../../utils/format.js";
import { Command } from "@langchain/langgraph";
import { ToolMessage } from "@langchain/core/messages/tool";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { AgentMessage } from "../index.js";

export class MimirToolToLangchainTool extends StructuredTool {

    schema = this.tool.schema;
    name: string = this.tool.name;
    description: string = this.tool.description;
    returnDirect: boolean = this.tool.returnDirect

    constructor(private tool: AgentTool) {
        super();
    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun, parentConfig?: ToolRunnableConfig): Promise<any> {
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
        return complexResponseToLangchainMessageContent(response as ComplexMessageContent[]);
    }
}
//TODO: This is a temporary solution, we need to find a better way to check if the response is an AgentMessage
export function isUserAgentMessage(x: ToolResponse): x is AgentMessage {
    if ((x as any).content) {
        return true;
    }
    return false;
}

