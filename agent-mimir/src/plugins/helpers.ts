
import { StructuredTool } from "langchain/tools";
import { AgentManager } from "../agent-manager/index.js";
import { BaseChatModel } from "langchain/chat_models";
import { z } from "zod";
import { AgentContext, AgentUserMessage, FILES_TO_SEND_FIELD, MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../schema.js";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";

export class TalkToHelper extends StructuredTool {

    schema = z.object({
        helperName: z.string().describe("The name of the helper you want to talk to and the message you want to send them."),
        message: z.string().describe("The message to the helper, be as detailed as possible."),
        workspaceFilesToShare: z.array(z.string()).optional().describe("The list of files of your work directory you want to share with the helper."),
    })

    constructor(private helperSingleton: AgentManager, private agentName: string) {
        super();
    }

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        const { helperName, message } = arg;
        const helper = this.helperSingleton.getAgent(helperName);
        const self = this.helperSingleton.getAgent(this.agentName);
        if (!helper) {
            return `There is no helper named ${helperName}, create one with the \`createHelper\` tool.`
        }
        const filesToSend = (arg.workspaceFilesToShare ?? [])
            .map((file) => {
                return self!.workspace.getUrlForFile(file);
            })
            .filter(value => value !== undefined)
            .map((file) => file!);

        const response = (await helper.call(true, { input: message, [FILES_TO_SEND_FIELD]: filesToSend }));
        const agentUserMessage: AgentUserMessage = response.output;

        let toolResponse = `Response from ${helper.name}: ${agentUserMessage.message}`;
        if (agentUserMessage.sharedFiles?.length ?? 0 > 0) {
            for (const file of agentUserMessage.sharedFiles ?? []) {
                await self?.workspace.loadFileToWorkspace(file.fileName, file.url);
                console.debug(`Loaded file ${file.fileName} from ${file.url} into ${self?.workspace.workingDirectory}`);
            }
            toolResponse = `The following files have been given to you by the helper and saved into your work directory: ${agentUserMessage.sharedFiles!.map((file) => file.fileName).join(", ")} \n\n`;
        }

        return toolResponse;
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

    pluginName: string = "helpers";

    constructor(private config: HelperPluginConfig) {
    }

    create(context: PluginContext): MimirAgentPlugin {
        return new HelpersPlugin(this.config);
    }
}

export class HelpersPlugin extends MimirAgentPlugin {

    private helperSingleton: AgentManager;
    private communicationWhitelist: string[] | null;
    private model: BaseChatModel;
    private agentName: string;

    name: string = "HelpersPlugin";
    

    constructor(config: HelperPluginConfig) {
        super();
        this.helperSingleton = config.helperSingleton;
        this.model = config.model;
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
        let tools: StructuredTool[] = [new TalkToHelper(this.helperSingleton, this.name)];
 
        return tools;
    }
}
