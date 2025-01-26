import { Agent } from "../schema.js";

export class AgentManager {
    private map: Map<string, Agent> = new Map();

    public addAgent(agent: Agent): void {
        this.map.set(agent.name, agent);
    }

    public getAgent(shortName: string): Agent | undefined {
        const agent = this.map.get(shortName);
        return agent
    }

    public getAllAgents(): Agent[] {
        return Array.from(this.map.values())
    }
}