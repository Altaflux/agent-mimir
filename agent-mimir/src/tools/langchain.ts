
import { AgentTool, ToolInputSchemaBase, ToolResponse } from "./index.js";
import { AgentPlugin, PluginFactory, PluginContext } from "../plugins/index.js";
import { lCmessageContentToContent } from "../agent-manager/message-utils.js";
import { MessageContent } from "@langchain/core/messages";
import { StructuredTool } from "@langchain/core/tools";
import { stringify } from 'yaml'
import { extractTextContentFromComplexMessageContent } from "../utils/format.js";

export class LangchainToolToMimirTool<SchemaT = ToolInputSchemaBase> extends AgentTool<SchemaT> {

    schema: SchemaT;
    name: string;
    description: string;
    returnDirect: boolean;

    constructor(private tool: StructuredTool, readonly namePrefix?: string) {
        super();
        this.schema = tool.schema as SchemaT;
        this.name = `${namePrefix ? namePrefix + "_" : ""}${tool.name}`;
        this.description = tool.description;
        this.returnDirect = tool.returnDirect;
    }
    protected async _call(arg: any): Promise<ToolResponse> {
        const response = await this.tool.invoke(arg);
        const messageContent = this.toMessageContent(response);
        const textContent = extractTextContentFromComplexMessageContent(messageContent);
        try {
            return [
                {
                    type: "text",
                    text: stringify(JSON.parse(textContent))
                }
            ]
        } catch {
            return messageContent;
        }

    }

    toMessageContent(response: any) {
        if (this.tool.responseFormat === "content_and_artifact" && Array.isArray(response)) {
            const responseContent = response[0];
            return lCmessageContentToContent(Array.isArray(responseContent) ? responseContent as MessageContent : [responseContent])
        }
        return lCmessageContentToContent(Array.isArray(response) ? response as MessageContent : [response])
    }
}

/**
 * Factory class for creating LangChain tool wrapper plugins
 */
export class LangchainToolWrapperPluginFactory implements PluginFactory {
    readonly name: string;

    constructor(private readonly tool: StructuredTool, private readonly namePrefix?: string) {
        this.name = tool.name;
    }

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new LangchainToolWrapper(this.tool, this.namePrefix);
    }
}

/**
 * Plugin class that wraps LangChain tools for use with Mimir
 */
class LangchainToolWrapper extends AgentPlugin {
    constructor(private readonly tool: StructuredTool, private readonly namePrefix?: string) {
        super();
    }

    async tools(): Promise<AgentTool[]> {
        return [new LangchainToolToMimirTool(this.tool, this.namePrefix)];
    }

}
