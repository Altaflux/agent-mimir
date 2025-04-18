import { AgentTool } from "../../tools/index.js";
import { z } from "zod";

import { ComplexMessageContent } from "../../schema.js";
import { StructuredTool, ToolRunnableConfig } from "@langchain/core/tools";
import { complexResponseToLangchainMessageContent } from "./../../utils/format.js";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";

export class MimirToolToLangchainTool extends StructuredTool {

    schema = this.tool.schema;
    name: string = this.tool.name;
    description: string = this.tool.description;

    constructor(private tool: AgentTool) {
        super();
    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun, parentConfig?: ToolRunnableConfig): Promise<any> {
        const response = await this.tool.call(arg);
        return complexResponseToLangchainMessageContent(response as ComplexMessageContent[]);
    }
}
