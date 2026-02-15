import { Client } from "@modelcontextprotocol/sdk/client/index.js";
export { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
export { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
export { StreamableHTTPClientTransport, StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
export { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { CallToolResult, EmbeddedResource, ImageContent, PromptMessage, TextContent } from "@modelcontextprotocol/sdk/types.js";

import { AgentCommand, AgentSystemMessage, CommandContent, AgentPlugin, PluginFactory, PluginContext } from "agent-mimir/plugins";
import { AgentTool, ToolResponse } from "agent-mimir/tools";
import { ComplexMessageContent } from "agent-mimir/schema";
import { z } from 'zod';
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { LangchainToolToMimirTool } from "agent-mimir/tools/langchain";

interface PluginResult {
    tools: AgentTool[];
    prompts: AgentCommand[];
}
export type McpClientParameters = {
    servers: Record<string, {
        description?: string,
        transport: () => Transport
    }>,
}
export class McpClientPluginFactory implements PluginFactory {
    public readonly name: string = "mcp-client";

    constructor(
        private readonly config: McpClientParameters
    ) { }

    async create(context: PluginContext): Promise<AgentPlugin> {
        try {
            const clientResults = await Promise.all(
                Object.entries(this.config.servers).map(async ([clientName, config]) => {
                    const init = await this.initializeClient(clientName, config.transport());
                    return {
                        clientName: clientName,
                        description: config.description,
                        client: init.client,
                        pluginResult: init.pluginResult
                    }
                })
            );

            const resourceTools = new McpResourceTool(clientResults);
            const combinedResult = this.combineResults(clientResults.map(c => c.pluginResult));
            return new McpPlugin(clientResults, [...combinedResult.tools, resourceTools], combinedResult.prompts);
        } catch (error) {
            console.error("Failed to create MCP plugin:", error);
            throw error;
        }
    }

    private async initializeClient(clientName: string, transport: Transport): Promise<{ pluginResult: PluginResult, client: Client }> {

        const client = new Client({
            name: "agent-client",
            version: "1.0.0",
        }, {
            capabilities: {
                
               
            }
        });

        try {
            await client.connect(transport);
            const [agentTools, commands] = await Promise.all([
                this.initializeTools(client, clientName),
                this.initializePrompts(client, clientName)
            ]);

            return {
                client: client,
                pluginResult: {
                    tools: agentTools,
                    prompts: commands
                }
            };
        } catch (error) {
            console.error(`Failed to initialize client ${clientName}:`, error);
            return {
                client: client,
                pluginResult: {
                    tools: [],
                    prompts: []
                }
            };
        }
    }

    private async initializeTools(client: Client, clientName: string): Promise<AgentTool[]> {
        try {
            const tools = await loadMcpTools(clientName, client)
            const agentTools = tools.map(t => new LangchainToolToMimirTool(t, clientName));
            return agentTools;
        } catch (error) {
            console.error(`Failed to list tools for client ${clientName}:`, error);
            return [];
        }
    }

    private async initializePrompts(client: Client, clientName: string): Promise<AgentCommand[]> {
        try {
            const prompts = await client.listPrompts();
            return prompts.prompts.map(prompt => ({
                name: `${clientName}_${prompt.name}`,
                description: prompt.description,
                arguments: prompt.arguments?.map(args => {
                    return {
                        name: args.name,
                        required: args.required ?? false,
                        description: args.description
                    }
                }),
                commandHandler: async (args) => {

                    const response = await client.getPrompt({
                        name: prompt.name,
                        arguments: args
                    });
                    return ContentConverter.convertPromptMessagesToCommandContent(response.messages);
                }
            } satisfies AgentCommand));
        } catch (error) {
            console.error(`Failed to list prompts for client ${clientName}:`, error);
            return [];
        }
    }

    private combineResults(results: PluginResult[]): { tools: AgentTool[], prompts: AgentCommand[] } {
        return results.reduce((combined, current) => ({
            tools: [...combined.tools, ...current.tools],
            prompts: [...combined.prompts, ...current.prompts]
        }), { tools: [] as AgentTool[], prompts: [] as AgentCommand[] });
    }
}




/**
 * Utility functions for content type conversion
 */
namespace ContentConverter {
    /** Determines the image type from a MIME type string */
    export const getImageType = (mimeType: string): "jpeg" | "png" => {
        if (mimeType.includes("jpg") || mimeType.includes("jpeg")) return "jpeg";
        return "png";
    };

    type McpContent = TextContent | ImageContent | EmbeddedResource;

    function convertContent(content: McpContent): ComplexMessageContent {
        switch (content.type) {
            case "text":
                return {
                    type: "text",
                    text: content.text
                } satisfies ComplexMessageContent;
            case "image":
                return {
                    type: "image_url",
                    image_url: {
                        type: getImageType(content.mimeType),
                        url: content.data
                    }
                } satisfies ComplexMessageContent;
            case "resource":
                return convertEmbeddedResourceToComplexResponse(content.resource);
            default:
                throw new Error(`Unsupported content type: ${(content as { type: string }).type}`);
        }
    }

    export function convertEmbeddedResourceToComplexResponse(resource: EmbeddedResource["resource"]): ComplexMessageContent {
        return {
            type: "text",
            text: JSON.stringify(resource)
        }
    }

    /** Converts a tool response to the standard ToolResponse format */
    export function convertToolToToolResponse(response: CallToolResult): ToolResponse {
        return response.content.map(content => convertContent(content as any));
    }

    /** Converts a prompt message to the standard CommandContent format */
    export function convertPromptMessagesToCommandContent(messages: PromptMessage[]): CommandContent[] {
        const commandContents = messages.map(message => {
            const role = message.role === "assistant" ? "assistant" : "user";
            let content: ComplexMessageContent = convertContent(message.content as any);

            return {
                type: role,
                content: [content]
            } satisfies CommandContent;
        });

        return packConsecutiveCommandContents(commandContents);
    }

    function packConsecutiveCommandContents(arr: CommandContent[]): CommandContent[] {
        if (!arr.length) return [];

        const packedCommandContent = arr.reduce((result, currentValue, index) => {
            // If this is the first element or if the current value is different from the last group
            if (index === 0 || currentValue.type !== arr[index - 1].type) {
                result.push([currentValue]);
            } else {
                // Add the current value to the last group
                result[result.length - 1].push(currentValue);
            }
            return result;
        }, [] as CommandContent[][]);

        return packedCommandContent.map(packed => {
            return packed.reduce((result, currentValue) => {
                return {
                    type: result.type,
                    content: [...result.content, ...currentValue.content]
                }
            }, {
                type: packed[0].type,
                content: []
            })
        })
    }
}

export class McpResourceTool extends AgentTool {
    schema = z.object({
        mcpServer: z.string().describe("The name of the MCP server to read from."),
        resourceURI: z.string().describe("The URI of the resource to read.")
    })
    constructor(private readonly clients: { client: Client, clientName: string }[]) {
        super()

    }
    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        let client = this.clients.find(c => c.clientName === arg.mcpServer)!;
        try {
            const resource = await client.client.readResource({
                uri: arg.resourceURI
            });
            if (!resource || resource.contents.length === 0) {
                return [{ type: "text", text: `No content found for resource ${arg.resourceURI}` }];
            }
            const response: ComplexMessageContent[] = resource.contents.map(c => {
                return ContentConverter.convertEmbeddedResourceToComplexResponse(c);
            })
            return response;
        } catch (err) {
            console.error(`Failed to read resource from ${arg.mcpServer}:`, err);
            return [{ type: "text", text: `Failed to read resource from ${arg.mcpServer}: ${err}` }];
        }

    }

    name: string = "fetch_mcp_resource";
    description: string = "Use this tool to read a resource from an MCP server.";

}
/**
 * Plugin implementation for the MCP client
 */
export class McpPlugin extends AgentPlugin {
    constructor(
        private readonly clients: { client: Client, clientName: string, description?: string }[],
        private readonly mcpTools: AgentTool[],
        private readonly prompts: AgentCommand[]
    ) {
        super();
    }

    async destroy(): Promise<void> {
        await Promise.all(this.clients.map(async client => await client.client.close()));
    }
    
    async getSystemMessages(): Promise<AgentSystemMessage> {

        const resourcesTemplate: string = (await Promise.all(this.clients.map(async c => {
            let instructions = c.description ?? ""
            try {
                instructions = instructions + ((" " + c.client.getInstructions()).trim() ?? "");
            } catch {

            }

            const serverInformation = `MCP Server: "${c.clientName}" ${instructions.length > 0 ? ` Description: "${instructions}"` : ""}`;
            try {
                let resources: Awaited<ReturnType<typeof c.client.listResources>> | undefined = undefined as any;
                try {
                    resources = await c.client.listResources({});
                }catch(e){
                }

                if (!resources?.resources?.length) {
                    return serverInformation;
                }
                const resourceTemplate = resources.resources.map(r => {
                    const description = r.description ? `Description: "${r.description}"` : "";
                    const mimeType = r.mimeType ? `MimeType: "${r.mimeType}"` : "";
                    return `-- Resource Name: "${r.name}" Resource URI: "${r.uri}" ${description} ${mimeType}`;
                }).join("\n");
                return `- ${serverInformation} with resources:\n${resourceTemplate}\n`;
            } catch {
                return serverInformation;
            }
        }))).join("\n\n");

        if (resourcesTemplate.trim().length > 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `You have access to toolkits which allow you to execute different actions, this toolkits are called MCP servers.\n
The servers besides providing tools, they also provide resources that you can read from as needed using the fetch_mcp_resource tool.\n
MCP Servers:\n${resourcesTemplate}`

                    }
                ]
            }
        };
        return {
            content: [{
                type: "text",
                text: resourcesTemplate
            }]
        }
    }

    async tools(): Promise<AgentTool[]> {
        return [...this.mcpTools];
    }

    async getCommands(): Promise<AgentCommand[]> {
        return [...this.prompts];
    }
}

