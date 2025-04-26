
import { AgentTool } from "../../tools/index.js";
import { AgentWorkspace } from "../index.js";

export { LocalPythonExecutor } from "./executors/local-executor.js";
export { CodeAgentFactory } from "./factory.js";
export { createAgent } from "./agent.js";


export interface CodeToolExecutor {

    availableDependencies: string[];
    
    setWorkSpace(workspace: AgentWorkspace): void;
    
    execute(tools: AgentTool[], code: string, toolInitCallback: (wsUrl: string, tools: AgentTool[]) => void): Promise<string>;
}


export interface ExecutorWorkspace {

    downloadFile(name: string): Promise<ReadableStream<Uint8Array>>;

    transferFile(name: string, stream: ReadableStream<Uint8Array>): Promise<void>
}