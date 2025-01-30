
import { z } from "zod";
import { AgentSystemMessage, MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../plugins/index.js";
import { AgentTool, ToolResponse } from "../tools/index.js";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { Agent, AgentMessage } from "../agent-manager/index.js";


export type HelperPluginConfig = {
    name: string,
    helperSingleton:  ReadonlyMap<string, Agent>,
    communicationWhitelist: string[] | null,
}

export class HelpersPluginFactory implements MimirPluginFactory {

    name: string = "helpers";

    constructor(private config: HelperPluginConfig) {
    }

    async create(context: PluginContext): Promise<MimirAgentPlugin> {

        return new HelpersPlugin(this.config);
    }
}


class HelperTool extends AgentTool {

    constructor(private helperSingleton: ReadonlyMap<string, Agent>, private agentName: string) {
        super();
    }
    schema = z.object({
        helperName: z.string().describe("The name of the helper you want to talk to and the message you want to send them."),
        message: z.string().describe("The message to the helper, be as detailed as possible."),
        workspaceFilesToSend: z.array(z.string().describe("File to share with the helper.")).optional().describe("The list of files of your workspace you want to share with the helper. You do not share the same workspace as the helpers, if you want the helper to have access to a file from your workspace you must share it with them."),
    })

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        const { helperName, message } = arg;
        const self = this.helperSingleton.get(this.agentName);
        const filesToSend = await Promise.all(((arg.workspaceFilesToSend ?? [])
            .map(async (fileName) => {
                return { fileName: fileName, url: (await self?.workspace.getUrlForFile(fileName))! };
            }).filter(async value => (await value).url !== undefined)));


        const result: AgentMessage = {
            destinationAgent: helperName,
            content: [
                {
                    type: "text",
                    text: message
                }
            ],
             sharedFiles: filesToSend,
        }
        return result;
    }
    name: string = "talkToHelper";
    description: string = `Talk to a helper.`;

}
export class HelpersPlugin extends MimirAgentPlugin {

    private helperSingleton:  ReadonlyMap<string, Agent>;
    private communicationWhitelist: string[] | null;
    private agentName: string;

    constructor(config: HelperPluginConfig) {
        super();
        this.helperSingleton = config.helperSingleton;
        this.communicationWhitelist = config.communicationWhitelist;
        this.agentName = config.name;
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


    tools(): AgentTool[] {
        let tools: AgentTool[] = [new HelperTool(this.helperSingleton, this.agentName)];
        return tools;
    }
}
