import { Client } from "@modelcontextprotocol/sdk/client/index.js";
export { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
export { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
export { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { CallToolResult, EmbeddedResource, ImageContent, PromptMessage, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { jsonSchemaToZod, JsonSchema } from "./json-schema-to-zod/index.js";
import { AgentCommand, CommandContent, ToolResponse } from "agent-mimir/schema";
import { AgentTool } from "agent-mimir/tools";
import { MimirAgentPlugin, PluginContext, MimirPluginFactory, ComplexResponse } from "agent-mimir/schema";
import { z } from "zod";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";


interface PluginResult {
    tools: AgentTool[];
    prompts: AgentCommand[];
}

export class McpClientPluginFactory implements MimirPluginFactory {
    public readonly name: string = "mcp-client";

    constructor(
        private readonly configs: Record<string, Transport>
    ) { }

    async create(context: PluginContext): Promise<MimirAgentPlugin> {
        try {
            const clientResults = await Promise.all(
                Object.entries(this.configs).map(([clientName, config]) =>
                    this.initializeClient(clientName, config)
                )
            );

            const combinedResult = this.combineResults(clientResults);
            return new McpPlugin(combinedResult.tools, combinedResult.prompts);
        } catch (error) {
            console.error("Failed to create MCP plugin:", error);
            throw error;
        }
    }

    private async initializeClient(clientName: string, transport: Transport): Promise<PluginResult> {

        const client = new Client({
            name: "agent-client",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
                prompts: {}
            }
        });

        try {
            await client.connect(transport);
            const [agentTools, commands] = await Promise.all([
                this.initializeTools(client, clientName),
                this.initializePrompts(client, clientName)
            ]);

            return {
                tools: agentTools,
                prompts: commands
            };
        } catch (error) {
            console.error(`Failed to initialize client ${clientName}:`, error);
            return {
                tools: [],
                prompts: []
            };
        }
    }

    private async initializeTools(client: Client, clientName: string): Promise<AgentTool[]> {
        try {
            const tools = await client.listTools();
            return tools.tools.map(tool => new McpTool(client, tool));
        } catch (error) {
            console.error(`Failed to list tools for client ${clientName}:`, error);
            return [];
        }
    }

    private async initializePrompts(client: Client, clientName: string): Promise<AgentCommand[]> {
        try {
            const prompts = await client.listPrompts();
            return prompts.prompts.map(prompt => ({
                name: prompt.name,
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

    private combineResults(results: PluginResult[]): PluginResult {
        return results.reduce((combined, current) => ({
            tools: [...combined.tools, ...current.tools],
            prompts: [...combined.prompts, ...current.prompts]
        }), { tools: [], prompts: [] });
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

    function convertContent(content: McpContent): ComplexResponse {
        switch (content.type) {
            case "text":
                return {
                    type: "text",
                    text: content.text
                } satisfies ComplexResponse;
            case "image":
                return {
                    type: "image_url",
                    image_url: {
                        type: getImageType(content.mimeType),
                        url: content.data
                    }
                } satisfies ComplexResponse;
            case "resource":
                return {
                    type: "text",
                    text: JSON.stringify(content.resource)
                } satisfies ComplexResponse;
            default:
                throw new Error(`Unsupported content type: ${(content as { type: string }).type}`);
        }
    }

    /** Converts a tool response to the standard ToolResponse format */
    export function convertToolToToolResponse(response: CallToolResult): ToolResponse {
        return response.content.map(content => convertContent(content));
    }

    /** Converts a prompt message to the standard CommandContent format */
    export function convertPromptMessagesToCommandContent(messages: PromptMessage[]): CommandContent[] {
        const commandContents = messages.map(message => {
            const role = message.role === "assistant" ? "assistant" : "user";
            let content: ComplexResponse = convertContent(message.content);

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

/**
 * Plugin implementation for the MCP client
 */
export class McpPlugin extends MimirAgentPlugin {
    constructor(
        private readonly mcpTools: AgentTool[],
        private readonly prompts: AgentCommand[]
    ) {
        super();
    }

    async tools(): Promise<AgentTool[]> {
        return [...this.mcpTools];
    }

    async getCommands(): Promise<AgentCommand[]> {
        return [...this.prompts];
    }
}

/**
 * Tool implementation for MCP operations
 */
class McpTool extends AgentTool {
    public readonly schema: z.ZodObject<any>;
    public readonly name: string;
    public readonly description: string;

    constructor(
        private readonly client: InstanceType<typeof Client>,
        private readonly mcpTool: Awaited<ReturnType<InstanceType<typeof Client>["listTools"]>>["tools"][0]
    ) {
        super();
        this.schema = jsonSchemaToZod(this.mcpTool.inputSchema as JsonSchema) as z.ZodObject<any>;
        this.name = this.mcpTool.name;
        this.description = this.mcpTool.description ?? "";
    }

    protected async _call(arg: Record<string, unknown>, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        try {
            const result = await this.client.callTool({
                name: this.mcpTool.name,
                arguments: arg
            });
            return ContentConverter.convertToolToToolResponse(result as CallToolResult);
        } catch (error) {
            console.error(`Failed to call tool ${this.name}:`, error);
            throw error;
        }
    }
}
