
import { AgentSystemMessage, AgentPlugin, PluginFactory, PluginContext, NextMessage, AttributeDescriptor } from "../plugins/index.js";
import { Agent } from "../agent-manager/index.js";


export type HelperPluginConfig = {
    name: string,
    helperSingleton: ReadonlyMap<string, Agent>,
    destinationAgentFieldName: string,
    communicationWhitelist: string[] | null,
}

export class HelpersPluginFactory implements PluginFactory {

    name: string = "helpers";

    constructor(private config: HelperPluginConfig) {
    }

    async create(context: PluginContext): Promise<AgentPlugin> {

        return new HelpersPlugin(this.config);
    }
}


export class HelpersPlugin extends AgentPlugin {

    private helperSingleton: ReadonlyMap<string, Agent>;
    private communicationWhitelist: string[] | null;
    private agentName: string;
    private destinationAgentFieldName: string;

    constructor(config: HelperPluginConfig) {
        super();
        this.helperSingleton = config.helperSingleton;
        this.communicationWhitelist = config.communicationWhitelist;
        this.agentName = config.name;
        this.destinationAgentFieldName = config.destinationAgentFieldName;
    }

    async attributes(nextMessage: NextMessage): Promise<AttributeDescriptor[]> {
        return [
            {
                attributeType: "string",
                name: "helperName",
                variableName: this.destinationAgentFieldName,
                description: "Set this parameter to the name of the helper you want to send a message. Only set it if you want to send a message to a helper, else do not set it. When set, the message you send will be sent to that helper instead of the user. If not set you will be responding to the user.",
            }
        ];
    }

    async getSystemMessages(): Promise<AgentSystemMessage> {

        const helpers = [...this.helperSingleton.values()];
        const whiteList = this.communicationWhitelist ?? helpers.map((helper) => helper.name) ?? [];
        const helperList = helpers.filter((helper) => helper.name !== this.agentName)
            .filter(element => whiteList.includes(element.name))
            .map((helper) => `${helper.name}: ${helper.description}`)
            .join("\n") ?? "";
        const helpersMessage = helperList !== "" ? `You have the following helpers that can be used to assist you in your task:\n${helperList}` : ``;

        return {
            content: [
                {
                    type: "text",
                    text: helpersMessage
                }
            ]
        }
    }
}
