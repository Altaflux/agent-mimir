import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ToolResponse } from "agent-mimir/schema";
import { AgentTool } from "agent-mimir/tools";
import { MimirAgentPlugin, PluginContext, MimirPluginFactory, ComplexResponse, NextMessageUser, AdditionalContent } from "agent-mimir/schema";

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
    create(context: PluginContext): MimirAgentPlugin {
        throw new Error("Method not implemented.");
    }

}