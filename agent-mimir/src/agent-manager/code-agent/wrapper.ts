import { AgentTool, ToolResponse } from "../../tools/index.js";
import { z } from "zod";
import { v4 } from "uuid";
import { ComplexMessageContent } from "../../schema.js";
import { StructuredTool, ToolRunnableConfig } from "@langchain/core/tools";
import { complexResponseToLangchainMessageContent } from "./../../utils/format.js";
import { Command } from "@langchain/langgraph";
import { ToolMessage } from "@langchain/core/messages/tool";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { AgentMessage } from "../../agent-manager/index.js";

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
        return complexResponseToLangchainMessageContent(response as ComplexMessageContent[]);
    }
}
