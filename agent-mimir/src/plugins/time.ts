import { AgentSystemMessage, AgentPlugin, PluginFactory, PluginContext } from "./index.js";

export class TimePluginFactory implements PluginFactory {

    name: string = "time";

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new TimePlugin();
    }

}

class TimePlugin extends AgentPlugin {

    async getSystemMessages(): Promise<AgentSystemMessage> {
        return {
            content: [
                {
                    type: "text",
                    text: `The current time is: ${new Date().toISOString()}`
                }
            ]
        };
    }
}
