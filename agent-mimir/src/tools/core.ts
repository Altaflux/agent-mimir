import { z } from "zod";
import { AgentUserMessage, AgentWorkspace, ToolResponse } from "../schema.js";
import { AgentTool } from "./index.js";
import { StructuredTool } from "@langchain/core/tools";

export class TalkToUserTool extends AgentTool {

    constructor(private workspace: AgentWorkspace) {
        super();
    }

    schema = z.object({
        messageToSend: z.string().describe("The message in markdown format you want to tell me."),
        workspaceFilesToShare: z.array(z.string().describe("A file name.")).optional().describe("The list of files from your workspace you want to respond back. Respond back files you want to send me or I have requested."),
    })

    returnDirect: boolean = true;

    protected async _call(arg: z.input<this["schema"]>): Promise<ToolResponse> {
        const files = await Promise.all((arg.workspaceFilesToShare || [])
            .map(async (file) => ({ fileName: file, url: (await this.workspace.getUrlForFile(file))! })));

        const result: AgentUserMessage = {
            message: arg.messageToSend,
            sharedFiles: files,
        }
        return [
            {
                type: "text",
                text: JSON.stringify(result)
            }
        ]
    }

    name: string = "respondBack";
    description: string = "Use to answer back anything you want to respond such as ackownledging that you have completed all the steps from a request, respond an answer back, ask me a question, or let me know about an issue you are facing.";
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
