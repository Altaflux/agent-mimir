import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { AgentWorkspace, MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../schema.js";

export class WorkspacePluginFactory implements MimirPluginFactory {

    name: string = "workspace";

    create(context: PluginContext): MimirAgentPlugin {
        return new WorkspacePlugin(context.workspace);
    }
}

class WorkspacePlugin extends MimirAgentPlugin {

    private workSpace: AgentWorkspace;

    constructor(workSpace: AgentWorkspace) {
        super();
        this.workSpace = workSpace;
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(`You have the following files in your workspace: {workspaceFiles}`),
        ];
    }

    async getInputs(): Promise<Record<string, any>> {
        return {
            workspaceFiles: (await this.workSpace.listFiles()).map((file) => `"${file}"`).join(", "),
        };
    }

}