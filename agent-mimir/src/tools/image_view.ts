import { StructuredTool } from "langchain/tools";
import { MimirAgentPlugin, MimirPluginFactory, MimirToolResponse, PluginContext, SupportedImageTypes } from "../schema.js";
import { z } from "zod";
import { AgentTool } from "./index.js";

export class ViewPluginFactory implements MimirPluginFactory {
    name: string = "viewImages";
    create(context: PluginContext): MimirAgentPlugin {
        return new ViewPlugin(context);
    }

}
export class ViewPlugin extends MimirAgentPlugin {
    constructor(private context: PluginContext) {
        super();
    }

    tools(): AgentTool [] {
        return [new ViewTool(this.context)];
    }
}

export class ViewTool extends AgentTool {

    name: string = "viewImageFromWorkspace";

    constructor(private context: PluginContext) {
        super();
    }

    description: string = "Use to view the files in your workspace.";
    schema = z.object({
        fileName: z.string().describe("The name of the file you want to view."),
    });

    protected async _call(arg: z.input<this["schema"]>): Promise<MimirToolResponse> {
        const file = (await this.context.workspace.fileAsBuffer(arg.fileName));
        if (file) {
            const imageType = arg.fileName.split('.').pop()! as SupportedImageTypes;
            const response: MimirToolResponse = {
                image_url: [{
                    type: imageType,
                    url: file.toString("base64"),
                }],
            };

            return response;
        }
        const response: MimirToolResponse = {
            text: `The file named ${arg.fileName} does not exist in your workspace.`,
        };
        return response;
    }

}