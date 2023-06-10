import { StructuredTool } from "langchain/tools";
import { AgentManager } from "../agent-manager/index.js";
import { BaseChatModel } from "langchain/chat_models";
import { z } from "zod";

export class TalkToUserTool extends StructuredTool {
    schema = z.object({
        messageToUser: z.string().describe("The message you want to tell the user."),
    })

    returnDirect: boolean = true;

    protected async _call(arg: z.input<this["schema"]>,): Promise<string> {
        return arg.messageToUser;
    }

    name: string = "talkToUser";
    description: string = "Useful when you want to present the answer to the request. Use it when you think that you are stuck or want to present the anwser to the user.";
}

export class EndTool extends StructuredTool {

    schema = z.object({
        messageToUser: z.string().describe("The message you want to tell the user."),
    })

    name: string;
    description: string = "Only call this command when the user has informed you that you have completed the task.";

    constructor(name: string) {
        super();
        this.name = name;
    }

    protected async _call(arg: string): Promise<string> {
        return arg;
    }
}


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

export class CompletePlanStep extends StructuredTool {

    schema = z.object({
        helperDescription: z.string().describe("The result of the step."),
    })

    constructor() {
        super();
    }
    protected async _call(arg: string): Promise<string> {
        return `If this is information that you need to present to the user do so with the "talkToUser" command:\n${arg}`;
    }
    name: string = "completePlanStep";
    description: string = "Use it when you have completed a step of the plan. ";
}


