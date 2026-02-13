import {  SupportedImageTypes } from "../schema.js";
import { z } from "zod/v4";
import { AgentTool, ToolResponse } from "./index.js";
import { AgentPlugin, PluginFactory, PluginContext } from "../plugins/index.js";

export class ViewPluginFactory implements PluginFactory {
    name: string = "viewImages";
    async create(context: PluginContext): Promise<AgentPlugin> {
        return new ViewPlugin(context);
    }

}
export class ViewPlugin extends AgentPlugin {
    constructor(private context: PluginContext) {
        super();
    }

    async tools(): Promise<AgentTool[]> {
        return [new ViewTool(this.context)];
    }
}
export class ViewTool extends AgentTool {

    name: string = "showImageFromWorkspace";

    constructor(private context: PluginContext) {
        super();
    }

    description: string = "Allows you you to see any image currently available in your workspace. This tool does not shares the image with the user, only for you to see.Use it when the given task requires you to understand the contents of an image.";
    schema = z.object({
        fileName: z.string().describe("The name of the image file you want to see."),
    });

    protected async _call(arg: z.input<this["schema"]>): Promise<ToolResponse> {
        const file = (await this.context.workspace.fileAsBuffer(arg.fileName));
        if (file) {
            let imageType = arg.fileName.split('.').pop()!;
            return [
                {
                    type: "image_url",
                    image_url: {
                        type: imageType as SupportedImageTypes,
                        url: file.toString("base64"),
                    }
                }
            ];
        }
        const response: ToolResponse = [
            {
                type: "text",
                text: `The file named ${arg.fileName} does not exist in your workspace.`
            }
        ];
        return response;
    }

}
