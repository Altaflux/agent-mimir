import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    CallToolResult,
    CallToolResultSchema,
    PromptMessage
} from "@modelcontextprotocol/sdk/types.js";

import { AgentCommand, CommandContent, ToolResponse } from "agent-mimir/schema";
import { AgentTool } from "agent-mimir/tools";
import { MimirAgentPlugin, PluginContext, MimirPluginFactory, ComplexResponse, NextMessageUser, AdditionalContent } from "agent-mimir/schema";
import { z } from "zod";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";

const transport = new StdioClientTransport({
    command: "path/to/server",
});


const client = new Client({
    name: "example-client",
    version: "1.0.0",
}, {
    capabilities: {}
});


await client.connect(transport);
client.listPrompts()

export class McpClientPluginFactory implements MimirPluginFactory {
    name: string = "mcp-client";
    constructor(private configs: Record<string, StdioServerParameters>) {

    }
    async create(context: PluginContext): Promise<MimirAgentPlugin> {
        const result = (await Promise.all(Object.keys(this.configs).map(async c => {
            const transport = new StdioClientTransport(this.configs[c]);
            const client = new Client({
                name: "example-client",
                version: "1.0.0",
            }, {
                capabilities: {
                    tools: {},
                    prompts: {}
                }
            });

            await client.connect(transport);

            const tools = await client.listTools();
            const agentTools = tools.tools.map( tool => {
                return new McpTool(client, tool);
            });
            const prompts = await client.listPrompts();
            let commands: AgentCommand[] = prompts.prompts.map(prompt => {
                return {
                    name: prompt.name,
                    description: prompt.description,
                    commandHandler: async (args) => {
                        let response = await client.getPrompt({
                            name: prompt.name,
                            arguments: args
                        });
                        return response.messages.map( m => convertPromptMessagesToCommandContent(m));
                    }
                } satisfies AgentCommand
            });

            return {
                tools: agentTools,
                prompts: commands
            }
        }))).reduce((l, r) => {
            
            return {
                tools: [...l.tools, ...r.tools],
                prompts: [...l.prompts, ...r.prompts]
            }
        }, {
            tools: [],
            prompts: []
        })

        return new McpPlugin(result.tools, result.prompts);
       
    }
}




function convertToolToToolResponse(response: CallToolResult): ToolResponse {
    const content: ComplexResponse[] = response.content.map( content => {
        
        if (content.type === "text") {
            return {
                type: "text",
                text: content.text
            } satisfies ComplexResponse
        } else if (content.type === "image") {
            let type = content.mimeType.includes("jpg") ? "jpeg" as const : content.mimeType.includes("jpeg") ? "jpeg"  as const: "png" as const;
            return {
                type: "image_url",
                image_url: {
                    type: type,
                    url: content.data
                } 
            } satisfies ComplexResponse
        } else if (content.type === "resource") {
            let resourceAsJson = JSON.stringify(content.resource);
            return {
                type: "text",
                text: resourceAsJson
            } satisfies ComplexResponse
        } else {
            throw new Error("Unreachable");
        }
    });

    return content;
}

function convertPromptMessagesToCommandContent(message: PromptMessage): CommandContent {
    let role: "user" | "assistant" = "user"
    if (message.role === "user") {
        role = "user"
    } else if (message.role === "assistant") {
        role = "assistant"
    }
    if (message.content.type === "text") {
        return {
            type: role,
            content: [{
                type: "text",
                text: message.content.text
            }]

        } satisfies CommandContent
    } else if (message.content.type === "image") {
        let type = message.content.mimeType.includes("jpg") ? "jpeg" as const : message.content.mimeType.includes("jpeg") ? "jpeg"  as const: "png" as const;
        return {
            type: role,
            content: [{
                type: "image_url",
                image_url: {
                    type: type,
                    url: message.content.data
                }
            }]

        } satisfies CommandContent
    } else if (message.content.type === "resource") {
        let resourceAsJson = JSON.stringify(message.content.resource);
        return {
            type: role,
            content: [{
                type: "text",
                text: resourceAsJson
            }]

        } satisfies CommandContent
    } else {
        throw new Error("Unreachable");
    }
}
export class McpPlugin extends MimirAgentPlugin {
    constructor(private mcpTools: AgentTool[], private prompts: AgentCommand[]) {
        super()
    }
    async tools(): Promise<(AgentTool)[]> {
        return this.mcpTools;
    }

    async getCommands(): Promise<AgentCommand[]> {
        return this.prompts;
    }
}

class McpTool extends  AgentTool {
    //schema = this.mcpTool.

    constructor(private client: InstanceType<typeof Client>, private mcpTool:  Awaited<ReturnType<InstanceType<typeof Client>["listTools"]>>["tools"][0] ) {
        super()
    }
    protected async _call(arg: any, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        let result = await this.client.callTool({
            name: this.mcpTool.name,
            arguments: arg
        });
        const toolResponse = convertToolToToolResponse(result as any);
        throw toolResponse;
    }
    schema = this.mcpTool.inputSchema as any
    name = this.mcpTool.name;
    description = this.mcpTool.description ?? "";
    
}