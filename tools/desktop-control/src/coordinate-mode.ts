import { ComplexMessageContent } from "@mimir/agent-core/schema";
import { AgentTool } from "@mimir/agent-core/tools";
import { ToolResponse } from "@mimir/agent-core/tools";
import si from 'systeminformation';
import { mouse, Point } from "@nut-tree-fork/nut-js";
import sharp from 'sharp';
import { z } from "zod/v4";
import { MouseMode } from "./mouse-mode.js";
import { getComputerScreenImage, getScreenTiles } from "./screen.js";

export class CoordinateMouseMode implements MouseMode {

    async init(): Promise<void> {

    }

    async reset(): Promise<void> {

    }

    async destroy(): Promise<void> {

    }
    instructionsMessage(): string {
        return `You can also use "moveMouseLocationOnComputerScreenGridCell" to move the mouse to a specific grid cell on the screen.`
    }
    async getScreenshot(): Promise<{ content: ComplexMessageContent[], finalImage: Buffer }> {
        const { finalImage, tiled } = await this.generateComputerImageForGrid();

        const sharpTiledImage = sharp(tiled);
        const finalTiledImageMetadata = await sharpTiledImage.metadata();
        const finalTiledImageResized = await sharpTiledImage.resize({ width: Math.floor(finalTiledImageMetadata.width! * (70 / 100)) }).toBuffer();

        const tilesMessage: ComplexMessageContent[] = [
            {
                type: "text" as const,
                text: `This image includes a grid of cells with numbers to help you identify the coordinates of the computer screen.If you want to use this coordinates use the "moveMouseLocationOnComputerScreenGridCell" tool to move the mouse to a specific location on the screen.`
            },
            {
                type: "image" as const,
                mimeType: "image/jpeg" as const,
                data: finalTiledImageResized.toString("base64")

            }
        ];

        return {
            finalImage: finalImage,
            content: [
                ...tilesMessage,
            ]
        }
    }

    async getTools() {
        return [new MoveMouseToCoordinate(998)]
    }

    async generateComputerImageForGrid(): Promise<{ tiled: Buffer, finalImage: Buffer }> {
        await new Promise(r => setTimeout(r, 1000));
        const computerScreenshot = await getComputerScreenImage();
        const tiles = await getScreenTiles(computerScreenshot);
        return {
            tiled: tiles.tiled,
            finalImage: tiles.originalImage
        }
    }
}

class MoveMouseToCoordinate extends AgentTool {

    constructor(private gridSize: number) {
        super();
    }

    schema = z.object({
        elementDescription: z.string().describe("A description of the element to which you are moving the mouse over."),
        gridCellNumber: z.number().int().describe("The cell number of the piece of the grid screen to click on."),

    })

    name: string = "moveMouseLocationOnComputerScreenGridCell";
    description: string = "Move the mouse to a location on the computer screen. Use the cell numbers on the computer screen to choose to which location to move the mouse.";

    protected async _call(arg: z.input<this["schema"]>): Promise<ToolResponse> {

        if (arg.gridCellNumber < 0 || arg.gridCellNumber > 999) {
            return [
                {
                    type: "text",
                    text: `The tile number must be between 1 and ${this.gridSize}`,
                },

            ]
        }

        const graphics = await si.graphics();
        const mainScreen = graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0];
        const cords = getTileCenterCoordinates(mainScreen.resolutionX ?? 0, mainScreen.resolutionY ?? 0, arg.gridCellNumber);
        console.log(`Moving mouse to: ${cords.x}, ${cords.y}`);
        await mouse.setPosition(new Point(cords.x, cords.y));

        return [
            {
                type: "text",
                text: "The mouse has moved to the new location, please make sure the mouse has moved to the correct location (look at the computer screen image), if that is not the case try again using different cell grid number.",
            },

        ]
    }

}

function getTileCenterCoordinates(imageWidth: number, imageHeight: number, tileNumber: number): { x: number, y: number } {
    // Validate tile number
    if (tileNumber < 0 || tileNumber > 999) {
        throw new Error('Tile number must be between 0 and 999');
    }

    // Grid dimensions
    const cellsX = 37;  // number of cells horizontally
    const cellsY = 27;  // number of cells vertically

    // Calculate cell dimensions
    const cellWidth = imageWidth / cellsX;
    const cellHeight = imageHeight / cellsY;

    // Calculate row and column of the tile
    const column = tileNumber % cellsX;
    const row = Math.floor(tileNumber / cellsX);

    // Calculate center coordinates
    const x = (column * cellWidth) + (cellWidth / 2);
    const y = (row * cellHeight) + (cellHeight / 2);

    return { x, y };
}
