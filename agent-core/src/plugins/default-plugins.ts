import { InputAgentMessage } from "../agent-manager/index.js";
import { AgentSystemMessage, AgentPlugin, PluginFactory, PluginContext, NextMessage, AttributeDescriptor, AdditionalContent } from "./index.js";

export class DefaultPluginFactory implements PluginFactory {

    name: string = "time";

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new DefaultPlugin();
    }

}

class DefaultPlugin extends AgentPlugin {

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
        ];
    }
}


