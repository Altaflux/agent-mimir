import { StructuredTool } from "langchain/tools";
import { AgentTool, ToolResponse } from "./index.js";
import { z } from "zod";
import { AgentPlugin, PluginFactory, PluginContext } from "../plugins/index.js";


class LangchainToolToMimirTool extends AgentTool {

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

/**
 * Factory class for creating LangChain tool wrapper plugins
 */
export class LangchainToolWrapperPluginFactory implements PluginFactory {
    readonly name: string;

    constructor(private readonly tool: StructuredTool) {
        this.name = tool.name;
    }

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new LangchainToolWrapper(this.tool);
    }
}

/**
 * Plugin class that wraps LangChain tools for use with Mimir
 */
class LangchainToolWrapper extends AgentPlugin {
    constructor(private readonly tool: StructuredTool) {
        super();
    }

    async tools(): Promise<AgentTool[]> {
        return [new LangchainToolToMimirTool(this.tool)];
    }

}
