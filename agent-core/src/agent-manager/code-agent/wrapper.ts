import { AgentTool } from "../../tools/index.js";
import { z } from "zod/v4";

import { ComplexMessageContent } from "../../schema.js";
import { StructuredTool, ToolRunnableConfig } from "@langchain/core/tools";
import { complexResponseToLangchainMessageContent } from "./../../utils/format.js";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";

export class MimirToolToLangchainTool extends StructuredTool {

    schema: any;
    name: string;
    description: string;

    constructor(private tool: AgentTool) {
        super();
        this.schema = tool.schema;
        this.name = tool.name;
        this.description = tool.description;
    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun, parentConfig?: ToolRunnableConfig): Promise<any> {
        const response = await this.tool.call(arg);
        return complexResponseToLangchainMessageContent(response as ComplexMessageContent[]);
    }
}
