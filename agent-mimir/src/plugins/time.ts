import { AgentContext, AgentSystemMessage, MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../schema.js";

export class TimePluginFactory implements MimirPluginFactory {

    name: string = "time";

    create(context: PluginContext): MimirAgentPlugin {
        return new TimePlugin();
    }

}

class TimePlugin extends MimirAgentPlugin {

    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {
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
