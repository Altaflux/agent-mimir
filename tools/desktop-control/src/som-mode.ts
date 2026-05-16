import { ComplexMessageContent } from "@mimir/agent-core/schema";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { AgentTool } from "@mimir/agent-core/tools";
import { ToolResponse } from "@mimir/agent-core/tools";
import screenshot from 'screenshot-desktop';
import si from 'systeminformation';
import { mouse, Point } from "@nut-tree-fork/nut-js";
import sharp from 'sharp';
import { z } from "zod/v4";
import { DesktopContext } from "./desktop-context.js";
import { MouseMode } from "./mouse-mode.js";
import { Coordinates, PythonServerControl } from "./sam.js";
import { getComputerScreenImage } from "./screen.js";

export class SomMouseMode implements MouseMode {

    private pythonServer: PythonServerControl = new PythonServerControl();

    private readonly desktopContext: DesktopContext = {
        coordinates: [],
    };

    async init(): Promise<void> {
        await this.pythonServer.init()
    }

    async reset(): Promise<void> {
        await this.pythonServer.close()
    }
    async destroy(): Promise<void> {

    }
    instructionsMessage(): string {
        return `You can also use "moveMouseLocationOnComputerScreenToLabel" to move the mouse to a specific label on the screen.`
    }
    async getScreenshot(): Promise<{ content: ComplexMessageContent[], finalImage: Buffer }> {
        const { screenshot, coordinates } = await this.generateComputerImageForSom();

        const sharpFinalImage = sharp(screenshot);
        const finalImageMetadata = await sharpFinalImage.metadata();
        const finalImageResized = await sharpFinalImage.resize({ width: Math.floor(finalImageMetadata.width! * (70 / 100)) }).toBuffer();


        const tilesMessage: ComplexMessageContent[] = [
            {
                type: "text" as const,
                text: `Screenshot of the computer's screen. Before you proceed to use the tools, make sure to pay close attention to the details provided in the image to confirm the outcomes of the actions you take to ensure accurate completion of tasks.`
            },
            {
                type: "image" as const,
                mimeType: "image/jpeg" as const,
                data: finalImageResized.toString("base64")
            }
        ];
        this.desktopContext.coordinates = coordinates;

        return {
            finalImage: screenshot,
            content: [
                ...tilesMessage,
            ]
        }
    }

    async getTools(): Promise<(AgentTool)[]> {
        return [new MoveMouseToLabel(this.desktopContext)]
    }

    async generateComputerImageForSom(): Promise<{ screenshot: Buffer, coordinates: Coordinates }> {
        await new Promise(r => setTimeout(r, 1000));
        const computerScreenshot = await getComputerScreenImage(false);
        const textBlocks = await this.pythonServer.getTextBlocks(computerScreenshot);
        const somImage = await this.pythonServer.addSam(computerScreenshot, textBlocks);
        return {
            screenshot: somImage.screenshot,
            coordinates: somImage.coordinates
        }
    }
}

class MoveMouseToLabel extends AgentTool {

    constructor(private context: DesktopContext) {
        super();
    }

    schema = z.object({
        labelNumber: z.number().describe("The number of the label to which move the mouse over."),
    })

    name: string = "moveMouseLocationOnComputerScreenToLabel";
    description: string = "Move the mouse to a location labeled on the computer screen. ";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {
        const coordinates = this.context.coordinates.filter((el) => el.index === arg.labelNumber)[0];

        if (!coordinates) {
            return [
                {
                    type: "text",
                    text: "The label number does not exist, please try again with a different label number.",
                },
            ]

        }
        const graphics = await si.graphics();
        const displays = await screenshot.listDisplays();
        const mainDisplay = (displays.find((el) => (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]).deviceName === el.name) ?? displays[0]) as { id: number; name: string, height: number, width: number };
        const mainScreen = graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0];

        const scaledX = Math.floor(((((mainScreen.resolutionX ?? 0) / mainDisplay.width) * 100) * coordinates.x) / 100);
        const scaledY = Math.floor(((((mainScreen.resolutionY ?? 0) / mainDisplay.height) * 100) * coordinates.y) / 100);
        const location = convertToPixelCoordinates2(mainScreen.resolutionX ?? 0, mainScreen.resolutionY ?? 0, scaledX, scaledY, 1, 1);

        await mouse.setPosition(new Point(location.xPixelCoordinate, location.yPixelCoordinate));
        return [
            {
                type: "text",
                text: "The mouse has moved to the new location, please be sure the mouse has moved to the expected location (look at the computer screen image).",
            },
        ]
    }
}

function convertToPixelCoordinates2(
    imageTotalXSize: number,
    imageTotalYSize: number,
    xPercentageCoordinate: number,
    yPercentageCoordinate: number,
    tileNumber: number,
    numberOfPieces: number
): { xPixelCoordinate: number, yPixelCoordinate: number } {

    const gridSize = Math.sqrt(numberOfPieces);

    const pieceWidth = imageTotalXSize! / gridSize;
    const pieceHeight = imageTotalYSize! / gridSize;

    let xPixelCoordinate = xPercentageCoordinate;
    let yPixelCoordinate = yPercentageCoordinate;

    const row = Math.floor((tileNumber - 1) / gridSize);
    const col = Math.ceil((tileNumber - 1) % gridSize);
    let nX = (col * pieceWidth) + xPixelCoordinate;
    let nY = (row * pieceHeight) + yPixelCoordinate;
    return {
        xPixelCoordinate: nX,
        yPixelCoordinate: nY
    }
}
