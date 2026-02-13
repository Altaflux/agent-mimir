
import { AgentTool } from "../../tools/index.js";
export { LocalPythonExecutor } from "./executors/local-executor.js";
export { DockerPythonExecutor } from "./executors/docker-executor.js";
export { CodeAgentFactory } from "./factory.js";
export { createAgent, createLgAgent } from "./agent.js";

export interface CodeToolExecutor {

    availableDependencies: string[];
    
    execute(tools: AgentTool[], code: string, libraries:string[], toolInitCallback: (wsUrl: string, tools: AgentTool[]) => void): Promise<string>;
}

