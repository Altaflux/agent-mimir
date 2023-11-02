import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { AgentWorkspace, FILES_TO_SEND_FIELD, MimirAgentPlugin, MimirPluginFactory, NextMessage, PluginContext } from "../schema.js";
import { ChainValues } from "langchain/schema";

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

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(`You have the following files in your workspace: {workspaceFiles}`),
        ];
    }

    async getInputs(): Promise<Record<string, any>> {
        return {
            workspaceFiles: (await this.workspace.listFiles()).map((file) => `"${file}"`).join(", "),
        };
    }

    async processMessage(nextMessage: NextMessage, inputs: ChainValues): Promise<NextMessage | undefined> {
        let message = nextMessage;
        if (nextMessage.type === "USER_MESSAGE") {
            if (inputs[FILES_TO_SEND_FIELD] && inputs[FILES_TO_SEND_FIELD] instanceof Array && inputs[FILES_TO_SEND_FIELD].length > 0) {
                for (const file of inputs[FILES_TO_SEND_FIELD]) {
                    await this.workspace.loadFileToWorkspace(file.fileName, file.url);
                }
                const filesToSendMessage = inputs[FILES_TO_SEND_FIELD].map((file: any) => `"${file.fileName}"`).join(", ");
                message = {
                    ...nextMessage,
                    message: `I am sending the following files into your workspace: ${filesToSendMessage} \n\n ${nextMessage.message}`
                }
            }
        }
        return message;
    }
}