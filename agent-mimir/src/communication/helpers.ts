
import { AgentSystemMessage, AgentPlugin, PluginFactory, PluginContext, NextMessage, AttributeDescriptor } from "../plugins/index.js";
import { Agent } from "../agent-manager/index.js";
import { USER_RESPONSE_MARKER } from "../utils/instruction-mapper.js";


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
                name: "agentNameToWhichSendTheMessage",
                required: false,
                variableName: this.destinationAgentFieldName,
                description: "Set this attribute to the name of the Agents you want to send a message. Only set it if you want to send a message to an Agents, else do not set it. When set, the message you send will be sent to that agent instead of the user. If not set you will be responding to the user.",
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
        const helpersMessage = helperList !== "" ? `You have access to the following Agents that you can talk to in order to assist you in your tasks. To talk to them set their name on the <agentNameToWhichSendTheMessage> XML element and what you want to send tell them below ${USER_RESPONSE_MARKER} :\n${helperList}` : ``;

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
