
import { CodeAgentFactory, LocalPythonExecutor,  createLgAgent as codeCreateLgAgent } from "agent-mimir/agent/code-agent";
import { FunctionAgentFactory, createLgAgent} from "agent-mimir/agent/tool-agent";
import { promises as fs } from 'fs';
import { FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import os from 'os';
import path from "path";
import {ChatOpenAI} from '@langchain/openai';
import { AdditionalContent, AgentPlugin, PluginContext, PluginFactory } from "agent-mimir/plugins";
import { InputAgentMessage } from "agent-mimir/agent";


class DummyPluginFactory implements PluginFactory {
    name: string = "dummyPlugin";
    async create(context: PluginContext): Promise<AgentPlugin> {
        return new (class extends AgentPlugin {
            async additionalMessageContent(message: InputAgentMessage): Promise<AdditionalContent[]> {

                return [
                    {
                        displayOnCurrentMessage: true,
                        saveToChatHistory: true,
                        content: [
                            {
                                type: "text",
                                text: `The current time is: ${new Date().toISOString()}`
                            }
                        ]
                    }
                ]
            }
        })
    }
}

async function createAgent() {
    const McpClientPluginFactory = (await import('@agent-mimir/mcp-client')).McpClientPluginFactory;
    const StdioClientTransport = (await import('@agent-mimir/mcp-client')).StdioClientTransport;

    const workingDirectory =  await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-cli-'));
    const workspaceFactory = async (agentName: string) => {
        const tempDir = path.join(workingDirectory, agentName);
        await fs.mkdir(tempDir, { recursive: true });
        const workspace = new FileSystemAgentWorkspace(tempDir);
        await fs.mkdir(workspace.workingDirectory, { recursive: true });
        return workspace;
    }
    const chatModel = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        temperature: 0.0,
        modelName: 'gpt-4.1-2025-04-14',
    });

    return await codeCreateLgAgent({
        name: "agent",
        description: "a helpful assistant",
        model: chatModel,
        profession: "a helpful assistant",
        workspaceFactory: workspaceFactory,
        visionSupport: "openai",
        codeExecutor: (workspace) => new LocalPythonExecutor({additionalPackages: [], workspace: workspace}),
        plugins:[
            new DummyPluginFactory(),
            new McpClientPluginFactory({
                servers: {
                    // "sqlite": {
                    //     description: "Query a Northwind SQLite database.",
                    //     transport: new StdioClientTransport({
                    //         "command": "docker",
                    //         "args": ["run", "-i", "--rm", "-v", "C:/AI:/mcp", "mcp/sqlite", "--db-path", "/mcp/northwind.db"]
                    //     })
                    // },
                    "brave-search": {
                        description: "Brave Search",
                        transport: new StdioClientTransport({
                            "command": "docker",
                            "args": ["run", "-i", "--rm", "-e", "BRAVE_API_KEY", "mcp/brave-search"],
                            "env": {
                                "BRAVE_API_KEY": ""
                            }
                        })
                    }
                }
            }),
        ]
    })
}

export const agent = (await createAgent()).graph;