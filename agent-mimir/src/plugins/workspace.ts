import { AgentContext, AgentSystemMessage, AgentWorkspace, FILES_TO_SEND_FIELD, MimirAgentPlugin, MimirPluginFactory, NextMessage, PluginContext, AdditionalContent } from "../schema.js";
import { ChainValues } from "@langchain/core/utils/types";

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

    async additionalMessageContent(nextMessage: NextMessage, inputs: ChainValues): Promise<AdditionalContent[]> {

        if (nextMessage.type === "USER_MESSAGE") {
            if (inputs[FILES_TO_SEND_FIELD] && inputs[FILES_TO_SEND_FIELD] instanceof Array && inputs[FILES_TO_SEND_FIELD].length > 0) {
                for (const file of inputs[FILES_TO_SEND_FIELD]) {
                    await this.workspace.loadFileToWorkspace(file.fileName, file.url);
                }
                const filesToSendMessage = inputs[FILES_TO_SEND_FIELD].map((file: any) => `"${file.fileName}"`).join(", ");
                return [
                    {
                        persistable: true,
                        content: [
                            {
                                type: "text",
                                text: `I am sending the following files into your workspace: ${filesToSendMessage} \n\n`
                            }
                        ]
                    }
                ]
            }
        }
        return []
    }

}