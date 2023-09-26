import { StructuredTool } from "langchain/tools";
import { z } from "zod";

export class TalkToUserTool extends StructuredTool {
    schema = z.object({
        messageToUser: z.string().describe("The message in plain text you want to tell the human."),
    })

    returnDirect: boolean = true;

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return arg.messageToUser;
    }

    name: string = "talkToUser";
    description: string = "Useful when you want to present the answer to the request. Use it when you think that you are stuck or want to present the anwser to the human.";
}

export class EndTool extends StructuredTool {

    schema = z.object({
        messageToUser: z.string().describe("The message in plain text you want to tell the human."),
    })

    name: string;
    description: string = "Only call this command when the human has informed you that you have completed the task.";

    constructor(name: string) {
        super();
        this.name = name;
    }

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return arg.messageToUser;
    }
}
