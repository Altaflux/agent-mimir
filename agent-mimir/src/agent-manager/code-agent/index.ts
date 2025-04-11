import { AgentTool } from "../../tools/index.js";



export { createAgent } from "./agent.js";


export interface CodeToolExecutor {

    execte(wsPort: number, tools: AgentTool[], code: string, toolInitCallback: (tools: AgentTool[]) => void): Promise<string>;
}