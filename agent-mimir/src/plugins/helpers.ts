
import { StructuredTool } from "langchain/tools";
import { AgentManager } from "../agent-manager/index.js";
import { BaseChatModel } from "langchain/chat_models";
import { z } from "zod";
import { AgentContext, AgentUserMessage, MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../schema.js";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";

export class TalkToHelper extends StructuredTool {

    schema = z.object({
        helperName: z.string().describe("The name of the helper you want to talk to and the message you want to send them."),
        message: z.string().describe("The message to the helper, be as detailed as possible."),
        workspaceFilesToShare: z.array(z.string().describe("File to share with the helper.")).optional().describe("The list of files of your work directory you want to share with the helper. You do not share the same workspace as the helpers, if you want the helper to have access to a file from your workspace you must share it with them."),
    })

    returnDirect: boolean = true;

    constructor(private helperSingleton: AgentManager, private agentName: string) {
        super();
    }

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        const { helperName, message } = arg;
        const self = this.helperSingleton.getAgent(this.agentName);
        const filesToSend = await Promise.all(((arg.workspaceFilesToShare ?? [])
            .map(async (fileName) => {
                return { fileName: fileName, url: (await self?.workspace.getUrlForFile(fileName))! };
            }).filter(async value => (await value).url !== undefined)));

        const result: AgentUserMessage = {
            agentName: helperName,
            message: message,
            sharedFiles: filesToSend,
        }
        return JSON.stringify(result);
    }
    name: string = "talkToHelper";
    description: string = `Talk to a helper. If a helper responds that it will do a task ask them again to complete the task. `;

}

export type HelperPluginConfig = {
    name: string,
    helperSingleton: AgentManager,
    communicationWhitelist: string[] | null,
    model: BaseChatModel,
}

export class HelpersPluginFactory implements MimirPluginFactory {

    name: string = "helpers";

    constructor(private config: HelperPluginConfig) {
    }

    create(context: PluginContext): MimirAgentPlugin {
        return new HelpersPlugin(this.config);
    }
}

export class HelpersPlugin extends MimirAgentPlugin {

    private helperSingleton: AgentManager;
    private communicationWhitelist: string[] | null;
    private agentName: string;

    constructor(config: HelperPluginConfig) {
        super();
        this.helperSingleton = config.helperSingleton;
        this.communicationWhitelist = config.communicationWhitelist;
        this.agentName = config.name;
    }

    async getInputs(_: AgentContext): Promise<Record<string, any>> {
        const helpers = this.helperSingleton?.getAllAgents() ?? [];
        const whiteList = this.communicationWhitelist ?? helpers.map((helper) => helper.name) ?? [];
        const helperList = helpers.filter((helper) => helper.name !== this.agentName)
            .filter(element => whiteList.includes(element.name))
            .map((helper) => `${helper.name}: ${helper.description}`)
            .join("\n") ?? "";
        const helpersMessage = helperList !== "" ? `You have the following helpers that can be used to assist you in your task:\n${helperList}` : ``;
        return {
            helpersMessage: helpersMessage
        };
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(`{helpersMessage}\n`),
        ];
    }


    tools(): StructuredTool[] {
        let tools: StructuredTool[] = [new TalkToHelper(this.helperSingleton, this.agentName)];

        return tools;
    }
}
