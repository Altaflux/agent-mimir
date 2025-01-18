import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    CallToolResult,
    CallToolResultSchema,
    PromptMessage
} from "@modelcontextprotocol/sdk/types.js";
import { jsonSchemaToZod, JsonSchema,  } from "./json-schema-to-zod/index.js";
import { AgentCommand, CommandContent, ToolResponse } from "agent-mimir/schema";
import { AgentTool } from "agent-mimir/tools";
import { MimirAgentPlugin, PluginContext, MimirPluginFactory, ComplexResponse, NextMessageUser, AdditionalContent } from "agent-mimir/schema";
import { z } from "zod";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { spawn } from "node:child_process";
import process from "node:process";

export default function runProcess() {
    // *** Return the promise
    return new Promise(function (resolve, reject) {

        const args = ["-y", "@simonb97/server-win-cli"];
        const processs = spawn('npx', args, {
            env: process.env,
            shell: false
        });
        processs.on('close', function (code) { // Should probably be 'exit', not 'close'
            // *** Process completed
            resolve(code);
        });
        processs.on('error', function (err) {
            // *** Process creation failed
            reject(err);
        });
    });
}
export const DEFAULT_INHERITED_ENV_VARS = process.platform === "win32"
    ? [
        "APPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "LOCALAPPDATA",
        "PATH",
        "PROCESSOR_ARCHITECTURE",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "USERNAME",
        "USERPROFILE",
    ]
    : /* list inspired by the default env inheritance of sudo */
    ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];

export function getDefaultEnvironment() {
    const env: any = {};
    for (const key of DEFAULT_INHERITED_ENV_VARS) {
        const value = process.env[key];
        if (value === undefined) {
            continue;
        }
        if (value.startsWith("()")) {
            // Skip functions, which are a security risk.
            continue;
        }
        env[key] = value;
    }
    return env;
}

export class McpClientPluginFactory implements MimirPluginFactory {
    name: string = "mcp-client";
    constructor(private configs: Record<string, StdioServerParameters>) {

    }
    async create(context: PluginContext): Promise<MimirAgentPlugin> {
        const result = (await Promise.all(Object.keys(this.configs).map(async c => {
            const config = this.configs[c];
            const transport = new StdioClientTransport(config);
            const client = new Client({
                name: "example-client",
                version: "1.0.0",
            }, {
                capabilities: {
                    tools: {},
                    prompts: {}
                }
            });

            // await runProcess()

            await client.connect(transport);

            const tools = await client.listTools();
            let myZ = z.object({
                fileName: z.string().describe("The name of the image file you want to see."),
            });
            const agentTools = tools.tools.map(tool => {
                return new McpTool(client, tool);
            });
            let commands: AgentCommand[] = []
            try {
                const prompts = await client.listPrompts();
                commands = prompts.prompts.map(prompt => {
                    return {
                        name: prompt.name,
                        description: prompt.description,
                        commandHandler: async (args) => {
                            let response = await client.getPrompt({
                                name: prompt.name,
                                arguments: args
                            });
                            return response.messages.map(m => convertPromptMessagesToCommandContent(m));
                        }
                    } satisfies AgentCommand
                });

            } catch (e) {

            }

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
    const content: ComplexResponse[] = response.content.map(content => {

        if (content.type === "text") {
            return {
                type: "text",
                text: content.text
            } satisfies ComplexResponse
        } else if (content.type === "image") {
            let type = content.mimeType.includes("jpg") ? "jpeg" as const : content.mimeType.includes("jpeg") ? "jpeg" as const : "png" as const;
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
        let type = message.content.mimeType.includes("jpg") ? "jpeg" as const : message.content.mimeType.includes("jpeg") ? "jpeg" as const : "png" as const;
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

class McpTool extends AgentTool {
    //schema = this.mcpTool.

    constructor(private client: InstanceType<typeof Client>, private mcpTool: Awaited<ReturnType<InstanceType<typeof Client>["listTools"]>>["tools"][0]) {
        super()

       // this.schema =  jsonSchemaToZod(this.mcpTool.inputSchema as any);
       // console.log("sd")
    }
    protected async _call(arg: any, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        let result = await this.client.callTool({
            name: this.mcpTool.name,
            arguments: arg
        });
        const toolResponse = convertToolToToolResponse(result as any);

  
       // this.schema = zod;
        throw toolResponse;
    }
    schema = jsonSchemaToZod(this.mcpTool.inputSchema as JsonSchema) as z.ZodObject<any>;
    name = this.mcpTool.name;
    description = this.mcpTool.description ?? "";

}