import { AgentTool } from "../tools/index.js";
import { z } from "zod";
import { ToolResponse } from "../schema.js";
import { StructuredTool } from "@langchain/core/tools";

export class MimirToolToLangchainTool extends StructuredTool {

    schema = this.tool.schema;
    name: string = this.tool.name;
    description: string = this.tool.description;
    returnDirect: boolean = this.tool.returnDirect

    constructor(private tool: AgentTool) {
        super();
    }
    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return JSON.stringify(await this.tool.call(arg));
    }
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
        return [
            {
                type: "text",
                text: await this.tool.call(arg)
            }
        ]

    }
}