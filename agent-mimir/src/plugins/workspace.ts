
import { promises as fs } from 'fs';
import { AgentContext, AgentSystemMessage, AttributeDescriptor, MimirAgentPlugin, MimirPluginFactory, PluginContext } from "./index.js";
import { AgentWorkspace, InputAgentMessage } from "../agent-manager/index.js";
import { ComplexMessageContent } from '../schema.js';

export class WorkspacePluginFactory implements MimirPluginFactory {
    name: string = "workspace";

    async create(context: PluginContext): Promise<MimirAgentPlugin> {
        return new WorkspacePlugin(context.workspace);
    }
}
export class WorkspanceManager {

    private workspace: AgentWorkspace;

    constructor(workspace: AgentWorkspace) {
        this.workspace = workspace;
    }

    async loadFiles(nextMessage: InputAgentMessage): Promise<void> {
        for (const file of nextMessage.sharedFiles ?? []) {
            await this.workspace.loadFileToWorkspace(file.fileName, file.url);
        }

    }

    async readAttributes(responseAttributes: Record<string, any>): Promise<InputAgentMessage["sharedFiles"]> {

        if (responseAttributes["workspaceFilesToShare"]) {
            const files = await Promise.all((JSON.parse(responseAttributes["workspaceFilesToShare"]) || [])
                .map(async (file: string) => ({ fileName: file, url: (await this.workspace.getUrlForFile(file))! })));

            return files;
        }
        return []
    }

    async additionalMessageContent(nextMessage: InputAgentMessage): Promise<ComplexMessageContent[]> {

        if (nextMessage.sharedFiles && nextMessage.sharedFiles.length > 0) {
            const filesToSendMessage = nextMessage.sharedFiles.map((file: any) => `"${file.fileName}"`).join(", ");
            return [
                {
                    type: "text",
                    text: `I am sending the following files into your workspace: ${filesToSendMessage} \n\n`
                }
            ]
        }
        return []
    }


}
class WorkspacePlugin extends MimirAgentPlugin {

    private workspace: AgentWorkspace;

    constructor(workspace: AgentWorkspace) {
        super();
        this.workspace = workspace;
    }

    async init(): Promise<void> {
        if (this.workspace.workingDirectory) {
            await fs.mkdir(this.workspace.workingDirectory, { recursive: true });
        }
    }



    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {
        const files = (await this.workspace.listFiles());
        const message = files.length > 0 ? `You have the following files in your workspace: ${files.join(", ")}` : "There are currently no files in your workspace.";
        return {
            content: [
                {
                    type: "text",
                    text: message
                }
            ]
        }
    }

    async attributes(): Promise<AttributeDescriptor[]> {
        return [
            {
                attributeType: "string[]",
                description: "The list of files from your workspace you want to send back to the user. Respond back files you want to send back or the user has requested.",
                name: "workspaceFilesToShare",
                example: `["image.jpg", "textFile.txt", "movie.avi"]`,
                variableName: "workspaceFilesToShare"
            }
        ];
    }

}