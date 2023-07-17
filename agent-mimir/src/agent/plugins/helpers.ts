
import { StructuredTool } from "langchain/tools";
import { AgentManager } from "../../agent-manager/index.js";
import { BaseChatModel } from "langchain/chat_models";
import { z } from "zod";
import { AgentContext, MimirAgentPlugin } from "../../schema.js";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";



export class TalkToHelper extends StructuredTool {

    schema = z.object({
        helperName: z.string().describe("The name of the helper you want to talk to and the message you want to send them."),
        message: z.string().describe("The message to the helper, be as detailed as possible."),
    })
    constructor(private helperSingleton: AgentManager) {
        super();
    }
    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        const { helperName, message } = arg;
        const helper = this.helperSingleton.getAgent(helperName);
        if (!helper) {
            return `There is no helper named ${helperName}, create one with the \`createHelper\` tool.`
        }
        const response = (await helper.agent.call({ input: message }))
        return `Response from ${helper.name}: ${response.output}`;
    }
    name: string = "talkToHelper";
    description: string = `Talk to a helper. If a helper responds that it will do a task ask them again to complete the task. `;

}

export class CreateHelper extends StructuredTool {

    schema = z.object({
        helperDescription: z.string().describe("The verbose description of the profession you want to talk to the helper about."),
    })

    constructor(private helperSingleton: AgentManager, private model: BaseChatModel) {
        super();
    }
    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return (await this.helperSingleton.createAgent({
            profession: arg.helperDescription,
            description: arg.helperDescription,
            model: this.model
        })).name;
    }
    name: string = "createHelper";
    description: string = "Creates a helper who is an expert on any profession, you can talk to them with the `talkToHelper` tool. ";

}


export type HelperPluginConfig = {
    name: string,
    helperSingleton: AgentManager,
    communicationWhitelist: string[] | null,
    model: BaseChatModel,
    allowAgentCreation: boolean,
}
export class HelpersPlugin extends MimirAgentPlugin {
    private helperSingleton: AgentManager;
    private communicationWhitelist: string[] | null;
    private model: BaseChatModel;
    private name: string;
    private allowAgentCreation: boolean;
    constructor(config: HelperPluginConfig) {
        super();
        this.helperSingleton = config.helperSingleton;
        this.model = config.model;
        this.communicationWhitelist = config.communicationWhitelist;
        this.name = config.name;
        this.allowAgentCreation = config.allowAgentCreation;
    }

    async getInputs(_: AgentContext): Promise<Record<string, any>> {
        const helpers = this.helperSingleton?.getAllAgents() ?? [];
        const whiteList = this.communicationWhitelist ?? helpers.map((helper) => helper.name) ?? [];
        const helperList = helpers.filter((helper) => helper.name !== this.name)
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
        let tools: StructuredTool[] = [new TalkToHelper(this.helperSingleton)];
        if (this.allowAgentCreation) {
            tools.push(new CreateHelper(this.helperSingleton, this.model));
        }
        return tools;
    }
}
