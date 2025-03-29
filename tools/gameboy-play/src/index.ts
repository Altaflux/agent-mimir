import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { z } from "zod";

import { ToolResponse } from "agent-mimir/tools";
import { AgentTool } from "agent-mimir/tools";
import { AdditionalContent, AgentPlugin, PluginFactory, NextMessageUser, PluginContext } from "agent-mimir/plugins";
import { InputAgentMessage } from "agent-mimir/agent";
import { GameboyController } from "./controller.js";

export class GameboyPluginFactory implements PluginFactory {
    constructor(private emulatorName: string) { }
    async create(context: PluginContext): Promise<AgentPlugin> {
        return new GameboyPlugin(this.emulatorName);
    }

    name: string = "gameboy_controller_plugin";
}

class GameboyPlugin extends AgentPlugin {

    private controller: GameboyController;

    constructor(emulatorName: string) {
        super();
        this.controller = new GameboyController(emulatorName)
    }

    init(): Promise<void> {

        return Promise.resolve();
    }
    async readyToProceed(nextMessage: NextMessageUser): Promise<void> {
        await new Promise(r => setTimeout(r, 100));
        return Promise.resolve();
    }

    async additionalMessageContent(message: InputAgentMessage): Promise<AdditionalContent[]> {

        let screen = await this.controller.captureScreen();
        return [
            {
                saveToChatHistory: 3,
                displayOnCurrentMessage: true,
                content: [
                    {
                        type: "image_url",
                        image_url: {
                            type: "jpeg",
                            url: screen.toString("base64")
                        },
                    }
                ]
            }
        ];
    }

    async tools(): Promise<(AgentTool)[]> {
        return [
            new GameboyControllerPlugin(this.controller),
        ];
    }
}

class GameboyControllerPlugin extends AgentTool {

    schema = z.object({
        action: z.enum(["a", "b", "start", "select", "up", "down", "left", "right"]).describe("The button to click on the gameboy."),
    })

    name: string = "gameboy_controller";
    description: string = "Control the Pokémon game using button presses.";
    private controller: GameboyController;

    constructor(controller: GameboyController) {
        super();
        this.controller = controller;
    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {
        await this.controller.pressButton(arg.action, 100);
        return [
            {
                type: "text",
                text: `Pressed ${arg.action} on the gameboy.`,
            }
        ]
    }
}