import { AgentContext, AgentSystemMessage, AgentWorkspace, FILES_TO_SEND_FIELD, MimirAgentPlugin, MimirPluginFactory, NextMessageUser, PluginContext, AdditionalContent, MimirAiMessage } from "../schema.js";
import { AttributeDescriptor } from "../schema.js";
import { promises as fs } from 'fs';
export class WorkspacePluginFactory implements MimirPluginFactory {

    name: string = "workspace";

    create(context: PluginContext): MimirAgentPlugin {
        return new WorkspacePlugin(context.workspace);
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

    async readResponse(aiMessage: MimirAiMessage, context: AgentContext, responseAttributes: Record<string, any>): Promise<Record<string, any>> {

        if (responseAttributes["workspaceFilesToShare"]) {
            const files = await Promise.all((JSON.parse(responseAttributes["workspaceFilesToShare"]) || [])
                .map(async (file: string) => ({ fileName: file, url: (await this.workspace.getUrlForFile(file))! })));

            return {
                [FILES_TO_SEND_FIELD]: files
            };
        }
        return {}
    }


    async additionalMessageContent(nextMessage: NextMessageUser, context: AgentContext): Promise<AdditionalContent[]> {

        if (context.requestAttributes[FILES_TO_SEND_FIELD] && context.requestAttributes[FILES_TO_SEND_FIELD] instanceof Array && context.requestAttributes[FILES_TO_SEND_FIELD].length > 0) {
            for (const file of context.requestAttributes[FILES_TO_SEND_FIELD]) {
                await this.workspace.loadFileToWorkspace(file.fileName, file.url);
            }
            const filesToSendMessage = context.requestAttributes[FILES_TO_SEND_FIELD].map((file: any) => `"${file.fileName}"`).join(", ");
            return [
                {
                    saveToChatHistory: true,
                    displayOnCurrentMessage: true,
                    content: [
                        {
                            type: "text",
                            text: `I am sending the following files into your workspace: ${filesToSendMessage} \n\n`
                        }
                    ]
                }
            ]
        }
        return []
    }

}