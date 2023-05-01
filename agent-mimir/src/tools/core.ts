import { Tool } from "langchain/tools";
import { AgentManager } from "../agent-manager/index.js";
import { BaseChatModel } from "langchain/chat_models";
import { simpleParseJson } from "../utils/json.js";


export class TalkToUserTool extends Tool {
    returnDirect: boolean = true;

    protected async _call(arg: string): Promise<string> {
        return arg;
    }
    name: string = "talkToUser";
    description: string = "Useful when you want to present the answer to the request. Use it when you think that you are stuck or want to present the anwser to the user. The input must be what you want to tell the user";
}

export class EndTool extends Tool {
    returnDirect: boolean = false;
    name: string;
    description: string = "Only call this command when the user has informed you that you have completed the task. The input must be what you want to tell the user.";

    constructor(name: string) {
        super();
        this.name = name;
    }

    protected async _call(arg: string): Promise<string> {
        return arg;
    }
}


export class TalkToHelper extends Tool {

    constructor(private helperSingleton: AgentManager) {
        super();
    }
    protected async _call(arg: string): Promise<string> {
        const { helperName, message } = await simpleParseJson(arg);
        const helper = this.helperSingleton.getAgent(helperName);
        if (!helper) {
            return `There is no helper named ${helperName}, create one with the \`createHelper\` tool.`
        }
        const response = (await helper.agent.call({ input: message }))
        return `Response from ${helper.name}: ${response.output}`;
    }
    name: string = "talkToHelper";
    description: string = `Talk to a helper. If a helper responds that it will do a task ask them again to complete the task. The input is: {{"helperName": name of the helper you want to talk to and the message you want to send them., message: the message to the helper, be as detailed as possible. }}  `;

}

export class CreateHelper extends Tool {
    constructor(private helperSingleton: AgentManager, private model: BaseChatModel) {
        super();
    }
    protected async _call(arg: string): Promise<string> {
        return (await this.helperSingleton.createAgent({
            profession: arg,
            description: arg,
            model: this.model
        })).name;
    }
    name: string = "createHelper";
    description: string = "Creates a helper who is an expert on any profession, you can talk to them with the `talkToHelper` tool. The input must be only the verbose description of the profession you want to talk to the helper about";

}

export class CompletePlanStep extends Tool {
    constructor() {
        super();
    }
    protected async _call(arg: string): Promise<string> {
        return `If this is information that you need to present to the user do so with the "talkToUser" command:\n${arg}`;
    }
    name: string = "completePlanStep";
    description: string = "Use it when you have completed a step of the plan: Input is the result of the step. ";
}


