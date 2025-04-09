import { AgentSystemMessage, AgentPlugin, PluginFactory, PluginContext, NextMessage, AttributeDescriptor } from "./index.js";

export class DefaultPluginFactory implements PluginFactory {

    name: string = "time";

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new DefaultPlugin();
    }

}

class DefaultPlugin extends AgentPlugin {

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

    async attributes(nextMessage: NextMessage): Promise<AttributeDescriptor[]> {
        const attributes: AttributeDescriptor[] = [];
        if (nextMessage.type === "TOOL_RESPONSE") {
            attributes.push({
                name: "taskResultDescription",
                attributeType: "string",
                variableName: "taskDesc",
                description: "Description of results of your previous action as well as a description of the state of the lastest element you interacted with.",
                example: "Example 1: I can see that the file was modified correctly and now contains the edited text. Example 2: I can see that the file was not modified correctly the text was not added.",
            });
        }
        return attributes;
    }
}


