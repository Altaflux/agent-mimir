import { StructuredTool } from "langchain/tools";
import { z } from "zod";
import { AgentUserMessage, WorkspaceManager } from "../schema.js";

export class TalkToUserTool extends StructuredTool {

    constructor(private workspace: WorkspaceManager) {
        super();
    }

    schema = z.object({
        messageToSend: z.string().describe("The message in markdown format you want to tell me."),
        workspaceFilesToShare: z.array(z.string()).optional().describe("The list of files of your work directory you want to share with the me. Share files you want to send me or I have requested."),
    })

    returnDirect: boolean = true;

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        const files = await Promise.all((arg.workspaceFilesToShare || [])
            .map(async (file) => ({ fileName: file, url: (await this.workspace.getUrlForFile(file))! })));
            
        const result: AgentUserMessage = {
            message: arg.messageToSend,
            sharedFiles: files,
        }
        return JSON.stringify(result);
    }

    name: string = "respondBack";
    description: string = "Use to answer back anything you want to respond.";
}

export class EndTool extends StructuredTool {

    schema = z.object({
        messageToSend: z.string().describe("The message in markdown format you want to tell me."),
    })

    name: string;
    description: string = "Only call this function when I have explicitly informed you that you have completed the task.";

    constructor(name: string) {
        super();
        this.name = name;
    }

    protected async _call(arg: z.input<this["schema"]>): Promise<string> {
        const result: AgentUserMessage = {
            message: arg.messageToSend,
            sharedFiles: [],
        }
        return JSON.stringify(result);
    }
}
