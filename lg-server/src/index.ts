
import { CodeAgentFactory, LocalPythonExecutor } from "agent-mimir/agent/code-agent";
import { FunctionAgentFactory, createLgAgent} from "agent-mimir/agent/tool-agent";
import { promises as fs } from 'fs';
import { FileSystemAgentWorkspace } from "agent-mimir/nodejs";
import os from 'os';
import path from "path";
import {ChatOpenAI} from '@langchain/openai';

async function createAgent() {
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

    return await createLgAgent({
        name: "agent",
        description: "a helpful assistant",
        model: chatModel,
        profession: "a helpful assistant",
        workspaceFactory: workspaceFactory,
        visionSupport: "openai"
    })
}

export const agent = (await createAgent()).graph;