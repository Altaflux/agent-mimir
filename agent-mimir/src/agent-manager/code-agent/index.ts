import { AgentTool } from "../../tools/index.js";



export { createAgent } from "./agent.js";


export interface CodeToolExecutor {

    execute(tools: AgentTool[], code: string, toolInitCallback: (wsUrl: string, tools: AgentTool[]) => void): Promise<string>;
}