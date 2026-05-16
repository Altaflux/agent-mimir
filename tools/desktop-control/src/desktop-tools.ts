import { ComplexMessageContent } from "@mimir/agent-core/schema";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { z } from "zod/v4";

import { ToolResponse } from "@mimir/agent-core/tools";
import { AgentTool } from "@mimir/agent-core/tools";
import { Key, keyboard, mouse, Button } from "@nut-tree-fork/nut-js";


class GetImageOfDesktop extends AgentTool {
    schema = z.object({});
    name: string = "getComputersScreenImage";

    description: string = "Get the image of the computer screen. Use this tool to get the image of the computer screen, this image can be used to identify elements on the screen, move the mouse, click, and type text.";

    constructor(private readonly getScreenFunc: () => Promise<ComplexMessageContent[]>) {
        super();
    }
    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {
        return await this.getScreenFunc();
    }

}
export class ClickPositionOnDesktop extends AgentTool {

    schema = z.object({
        clickButton: z.enum(["rightButton", "leftButton"]).describe(`The button to be clicked.`),
        typeOfClick: z.enum(["singleClick", "doubleClick"]).describe(`The type of mouse click to perform.`),
    });

    name: string = "mouseClickOnComputerScreen";

    description: string = "Click in a location on the computer screen, be sure the mouse is located correctly at the location intended to be clicked.";

    constructor(private readonly getScreenFunc: () => Promise<ComplexMessageContent[]>) {
        super();
    }
    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {
        const button = arg.clickButton === "leftButton" ? Button.LEFT : Button.RIGHT;

        if (arg.typeOfClick === "singleClick") {
            await mouse.click(button);
        } else if (arg.typeOfClick === "doubleClick") {
            await mouse.doubleClick(button);
        }

        return [
            {
                type: "text",
                text: "The mouse has moved to the new location and clicked.",
            },
            ... await this.getScreenFunc()
        ]

    }
}
export class TypeTextOnDesktop extends AgentTool {
    schema = z.object({
        keys: z.string().describe("The text to type to the computer."),
    });

    name: string = "typeTextToComputer";
    description: string = "Type a piece of text into the computer. Use this tool when you want to type a piece of text into the computer. IMPORTANT!!! Before calling this tool be sure that the text field where you want to type is clicked first and in focus, also verify that whatever you typed was correctly typed. This tool is preferred over the \"sendKeybordInputToComputer\" tool, but if you are not succeeding try using then try the \"sendKeybordInputToComputer\" tool.";

    constructor(private readonly getScreenFunc: () => Promise<ComplexMessageContent[]>) {
        super();
    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {


        await mouse.click(Button.LEFT);

        await keyboard.type(arg.keys);

        return [
            {
                type: "text",
                text: "The text has been sent to the computer, please verify they were typed as you expected.",
            },
            ... await this.getScreenFunc()
        ]
    }
}


export class ScrollScreen extends AgentTool {
    schema = z.object({
        direction: z.enum(["up", "down"]).describe(`The direction to which scroll the website.`),
    })

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {

        if (arg.direction === "up") {
            await keyboard.type(Key.PageUp);
        } else {
            await keyboard.type(Key.PageDown);
        }

        return [
            {
                type: "text",
                text: "The application has been scrolled.",
            },

        ]
    }
    name = "scrollComputerScreen";
    description = `Use when you need to scroll up or down the current application in the computer.`;
}


export class TypeOnDesktop extends AgentTool {
    schema = z.object({
        keys: z.array(z.object({
            key: z.string().describe("The key to type. Keys must be in Upper Cammel Case format, for example 'Enter', 'Backspace', 'Delete', 'PageDown', 'PageUp'."),
            action: z.enum(["typeKey", "pressKey", "releaseKey"]).describe(`The action to perform to a key. You can use any keys (including special keys) that are available in the nut-js library.`),
        })).describe("The keys to type."),
    });

    name: string = "sendKeybordInputToComputer";
    description: string = "Send keyboard presses to the computer. Only use this tool to execute special keyboard actions, if you need to type a piece of text into the computer use the \"typeTextToComputer\" tool.";

    constructor(private readonly getScreenFunc: () => Promise<ComplexMessageContent[]>) {
        super();
    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {

        for (const key of arg.keys) {
            let keyValue = Key[key.key as keyof typeof Key];

            if (!keyValue) {
                keyValue = Key[key.key.toUpperCase() as keyof typeof Key];
            }

            if (!keyValue) {
                console.log(`Typing Key: ${key.key}`);
                await keyboard.type(key.key);
                return [
                    {
                        type: "text",
                        text: "The keys have been sent to the computer.",
                    }
                ]
            }

            console.log(`Clicking Key: ${key.key} - ${keyValue}`);
            if (key.action === "typeKey") {
                await keyboard.type(keyValue);
            } else if (key.action === "pressKey") {
                await keyboard.pressKey(keyValue);
            } else if (key.action === "releaseKey") {
                await keyboard.releaseKey(keyValue);
            }
        }
        return [
            {
                type: "text",
                text: "The keys have been sent to the computer.",
            },
            ... await this.getScreenFunc()
        ]

    }
}
