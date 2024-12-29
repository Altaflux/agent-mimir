import { AgentTool } from "../tools/index.js";
import { z } from "zod";
import { AgentUserMessage, ComplexResponse, ToolResponse } from "../schema.js";
import { StructuredTool } from "@langchain/core/tools";
import { complexResponseToLangchainMessageContent } from "./format.js";
import { Command } from "@langchain/langgraph";

export class MimirToolToLangchainTool extends StructuredTool {

    schema = this.tool.schema;
    name: string = this.tool.name;
    description: string = this.tool.description;
    returnDirect: boolean = this.tool.returnDirect

    constructor(private tool: AgentTool) {
        super();
    }
    protected async _call(arg: z.input<this["schema"]>): Promise<any> {
        const response = await this.tool.call(arg);
        // if (isUserAgentMessage(response)) {
        //     return new Command({
        //         update: {
        //           foo: "baz",
        //         },
        //         goto: "myOtherNode",
        //       });
        // } else {
           
        // }
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
        return {
            rawResponse:  await this.tool.invoke(arg)
        }

    }
}