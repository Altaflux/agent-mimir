import { StructuredTool } from "@langchain/core/tools";
import { MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../schema.js";
import { LangchainToolToMimirTool } from "../utils/wrapper.js";

/**
 * Factory class for creating LangChain tool wrapper plugins
 */
export class LangchainToolWrapperPluginFactory implements MimirPluginFactory {
    readonly name: string;

    constructor(private readonly tool: StructuredTool) {
        this.name = tool.name;
    }

    async create(context: PluginContext): Promise<MimirAgentPlugin> {
        return new LangchainToolWrapper(this.tool);
    }
}

/**
 * Plugin class that wraps LangChain tools for use with Mimir
 */
export class LangchainToolWrapper extends MimirAgentPlugin {
    constructor(private readonly tool: StructuredTool) {
        super();
    }

    tools(): Promise<any[]> | any[] {
        return [new LangchainToolToMimirTool(this.tool)];
    }
    
}
