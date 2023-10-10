import { StructuredTool } from "langchain/tools";
import { z } from "zod";

export class TalkToUserTool extends StructuredTool {
    schema = z.object({
        messageToSend: z.string().describe("The message in plain text you want to tell me."),
        workspaceFilesToShare: z.array(z.string()).optional().describe("The list of files of your working directory you want to share with the me. Share files you want to send me or I have requested. ."),
    })

    returnDirect: boolean = true;

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return JSON.stringify(arg);
    }

    name: string = "respondBack";
    description: string = "Use to answer back anything you want to respond.";
}

export class EndTool extends StructuredTool {

    schema = z.object({
        messageToSend: z.string().describe("The message in plain text you want to tell me."),
    })

    name: string;
    description: string = "Only call this command when I have informed you that you have completed the task.";

    constructor(name: string) {
        super();
        this.name = name;
    }

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        return arg.messageToSend;
    }
}
