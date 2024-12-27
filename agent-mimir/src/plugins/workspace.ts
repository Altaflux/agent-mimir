import { AgentContext, AgentSystemMessage, AgentWorkspace, FILES_TO_SEND_FIELD, MimirAgentPlugin, MimirPluginFactory, NextMessageUser, PluginContext, AdditionalContent, MimirAiMessage } from "../schema.js";
import { AttributeDescriptor } from "../utils/instruction-mapper.js";
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

    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {
        const files = (await this.workspace.listFiles());
        const message = files.length > 0 ? `You have the following files in your workspace: ${files.join(", ")}` : "There are currently no files in your workspace. You cannot use the \"viewImageFromWorkspace\" tool.";
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
                description: "The list of files from your workspace you want to respond back. Respond back files you want to send me or I have requested.",
                name: "workspaceFilesToShare",
                example: `["image.jpg", "textFile.txt", "movie.avi"]`,
                variableName: "workspaceFilesToShare"
            }
        ];
    }

    async readResponse(aiMessage: MimirAiMessage, context: AgentContext, responseAttributes: Record<string, any>): Promise<Record<string, any>> {
        if (responseAttributes["workspaceFilesToShare"]) {
            return {
                "filesToSend": JSON.parse(responseAttributes["workspaceFilesToShare"])
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