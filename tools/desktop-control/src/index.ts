import { MimirAgentPlugin, PluginContext, MimirPluginFactory, AgentWorkspace, AgentContext, NextMessage } from "agent-mimir/schema";
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { z } from "zod";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";

import { AgentTool, ToolResponse } from "agent-mimir/tools";
import screenshot, { DisplayID } from 'screenshot-desktop';
import si from 'systeminformation'
import { ChainValues, SystemMessage } from "langchain/schema";
import { Key, keyboard, mouse, Button, Point } from "@nut-tree/nut-js";
import { promises as fs } from 'fs';
import sharp from 'sharp'

export class DesktopControlPluginFactory implements MimirPluginFactory {

    name: string = "desktopControl";

    create(context: PluginContext): MimirAgentPlugin {
        return new DesktopControlPlugin();
    }
}

class DesktopControlPlugin extends MimirAgentPlugin {
    async init(): Promise<void> {

    };

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            new MessagesPlaceholder("desktopImage")
        ]
    };


    async getInputs(context: AgentContext): Promise<Record<string, any>> {

        const tiles = await getScreenTiles();
        const tilesMessageContent = tiles.tiles.map((tile) => {
            return {
                type: "image_url" as const,
                image_url: `data:image/png;base64,${tile.toString("base64")}`,
            }

        })
        return {
            desktopImage: [
                new SystemMessage({
                    content: [
                        {
                            type: "text",
                            text: "This image is the user's computer's screen. You can control the computer by moving the mouse, clicking and typing. "
                        },
                        {
                            type: "image_url",
                            image_url: `data:image/png;base64,${tiles.originalImage.toString("base64")}`
                        }
                    ]
                }),
                new SystemMessage({
                    content: [
                        {
                            type: "text",
                            text: "This images are the tiles of pieces of the user's computer's screen. They include a red plot overlay and there tile number to help you identify the coordinates of the screen. "
                        },
                        ...tilesMessageContent
                    ]
                })
            ]
        };
    }

    tools(): AgentTool[] {
        return [
            new MoveMouse(),
            new ClickPositionOnDesktop(),
            new TypeOnDesktop(),
        ]
    };
}


async function addMouse(imageBuffer: Buffer) {
    const mousePosition = await mouse.getPosition();
    const displays = await screenshot.listDisplays();
    const graphics = await si.graphics();
    const mainGraphic = (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]);
    const mainDisplay = (displays.find((el) => mainGraphic.deviceName === el.name) ?? displays[0]) as { id: DisplayID; name: string; dpiScale: number };
    const mouseLocation = { x: mousePosition.x * mainDisplay.dpiScale, y: mousePosition.y * mainDisplay.dpiScale }

    const mouseIcon = `<svg x="${(mouseLocation.x - 25)}px" y="${(mouseLocation.y - 15)}px"
    viewBox="0 0 28 28" enable-background="new 0 0 28 28" xml:space="preserve" width="100px" height="100px">
<polygon fill="#FFFFFF" points="8.2,20.9 8.2,4.9 19.8,16.5 13,16.5 12.6,16.6 "/>
<polygon fill="#FFFFFF" points="17.3,21.6 13.7,23.1 9,12 12.7,10.5 "/>
<rect x="12.5" y="13.6" transform="matrix(0.9221 -0.3871 0.3871 0.9221 -5.7605 6.5909)" width="2" height="8"/>
<polygon points="9.2,7.3 9.2,18.5 12.2,15.6 12.6,15.5 17.4,15.5 "/>
</svg>`

    let strurcturedImage = sharp(imageBuffer)
    const metadata = await strurcturedImage.metadata();
    const width = metadata.width;
    const height = metadata.height;
    const overlaySvg = `<svg  height="${height}" width="${width}">${mouseIcon}</svg>`;
    const overlayBuffer = Buffer.from(overlaySvg);
    strurcturedImage = sharp(imageBuffer)
        .composite([{ input: overlayBuffer, top: 0, left: 0 }])

    return await strurcturedImage.toBuffer();
}



async function drawGridForTile(imageBuffer: Buffer, imageNumber: number, padding = 100) {


    const primeImage = sharp(imageBuffer)
    const metadata = await primeImage.metadata();
    const width = metadata.width!;
    const height = metadata.height!;

    // Adjust the total width and height to include padding
    const paddedWidth = width + padding * 2;
    const paddedHeight = height + padding * 2;

    // Adjust the spacing for the lines
    const lineSpacingX = width / 10;
    const lineSpacingY = height / 10;

    const svgElements = [];

    svgElements.push(`<text x="${width / 2}" y="${padding - 60}" font-size="35" fill="red">Image Number: ${imageNumber}</text>`);
    for (let i = 0; i <= 100; i = i + 10) {
        // Calculate positions for lines and text, offset by padding
        const x = (i / 10) * lineSpacingX + padding;
        const y = (i / 10) * lineSpacingY + padding;

        // Vertical lines and numbering
        svgElements.push(`<line x1="${x}" y1="${padding}" x2="${x}" y2="${height + padding}" stroke="red" stroke-width="2"/>`);
        //svgElements.push(`<text x="${x - 20}" y="${padding - 10}" font-size="35" fill="red">${i}</text>`);
        svgElements.push(`<text x="${x - 10}" y="${height + padding + 40}" font-size="35" fill="red">${i}</text>`);

        // Horizontal lines and numbering
        svgElements.push(`<line x1="${padding}" y1="${y}" x2="${width + padding}" y2="${y}" stroke="red" stroke-width="2"/>`);

        const reverseValue = (i - 100) * -1;
        svgElements.push(`<text x="${padding - 60}" y="${y + 5}" font-size="35" fill="red">${reverseValue}</text>`);
        //svgElements.push(`<text x="${width + padding + 30}" y="${y + 5}" font-size="35" fill="red">${reverseValue}</text>`);

        let initialY = padding;
        for (let j = 0; j <= 100; j = j + 10) {
            const secondReverseValue = (j - 100) * -1;
            svgElements.push(`<text x="${x}" y="${initialY}" font-size="15" fill="red">(${i}, ${secondReverseValue})</text>`);
            initialY = initialY + lineSpacingY;
        }

    }

    const overlaySvg = `<svg height="${paddedHeight}" width="${paddedWidth}">${svgElements.join('')}</svg>`;
    try {
        const overlayBuffer = Buffer.from(overlaySvg);
        const strurcturedImage = await primeImage
            .extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .composite([{ input: overlayBuffer, top: 0, left: 0 }])
            .toBuffer();

        return await sharp(strurcturedImage)
            .resize({ width: 1500 })
            .toBuffer();
    } catch (error) {
        throw error;
    }
}

async function getScreenTiles(numberOfPieces = 16) {

    const graphics = await si.graphics();
    const displays = await screenshot.listDisplays();
    const mainDisplay = (displays.find((el) => (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]).deviceName === el.name) ?? displays[0]) as { id: number; name: string, height: number, width: number };
    let image = await addMouse(await screenshot({ screen: mainDisplay.id, format: 'png' }))
    const sharpImage = sharp(image);
    const metadata = (await sharpImage.metadata())!;
    const gridSize = Math.sqrt(numberOfPieces);

    const pieceWidth = metadata.width! / gridSize;
    const pieceHeight = metadata.height! / gridSize;
    // Extract and save each piece
    let tiles = [];
    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            const left = col * pieceWidth;
            const top = row * pieceHeight;
            const img = await sharpImage.clone()
                .extract({ left: Math.floor(left), top: Math.floor(top), width: Math.floor(pieceWidth), height: Math.floor(pieceHeight) })
                .toBuffer();
            const finalImage = await drawGridForTile(img, row * gridSize + col + 1);
            tiles.push(finalImage);

        }
    }
    const fullImage = await sharpImage.resize({ width: 1500 }).toBuffer();
    return {
        originalImage: fullImage,
        tiles: tiles
    };
}



class MoveMouse extends AgentTool {
    schema = z.object({
        coordinates: z.object({
            tileNumber: z.number().int().describe("The tile number of the piece of the screen to click on."),
            xCoordinate: z.number().int().min(1).max(100).describe("The x axis coordinate of the of the position of the click on the screen, the axis can be any value between 1 and 100."),
            yCoordinate: z.number().int().min(1).max(100).describe("The y axis coordinate of the of the position of the click on the screen, the axis can be any value between 1 and 100."),
        }).describe("The coordinates of the click on the screen, be as precise as possible!"),

    })

    name: string = "moveMouseLocationOnComputerScreen";
    description: string = "Move the mouse to a location on the computer screen. Any x and y coordinates value inside the graph is valid, be as precise as possible!";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {
        const graphics = await si.graphics();
        const mainScreen = graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0];
        const location = convertToPixelCoordinates2(mainScreen.resolutionX ?? 0, mainScreen.resolutionY ?? 0, arg.coordinates.xCoordinate, arg.coordinates.yCoordinate, arg.coordinates.tileNumber, 16);

        await mouse.setPosition(new Point(location.xPixelCoordinate, location.yPixelCoordinate));
        return {
            text: "The mouse has moved to the new location, please be sure the mouse has moved to the expected location.",

        }
    }
}

class ClickPositionOnDesktop extends AgentTool {

    schema = z.object({
        clickButton: z.enum(["rightButton", "leftButton"]).describe(`The button to be clicked.`),
        typeOfClick: z.enum(["singleClick", "doubleClick"]).describe(`The type of mouse click to perform.`),
    });

    name: string = "clickLocationOnComputerScreen";

    description: string = "Click in a location on the computer screen, be sure the mouse is located correctly at the location intended to be clicked.";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {
        const button = arg.clickButton === "leftButton" ? Button.LEFT : Button.RIGHT;

        if (arg.typeOfClick === "singleClick") {
            await mouse.click(button);
        } else if (arg.typeOfClick === "doubleClick") {
            await mouse.doubleClick(button);
        }

        return {
            text: "The mouse has moved to the new location and clicked.",

        }
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
    const reverseY = (yPercentageCoordinate - 100) * -1;

    const row = Math.floor(tileNumber / gridSize);
    const col = (tileNumber % gridSize) - 1;

    let xPixelCoordinate = (xPercentageCoordinate / 100) * pieceWidth;
    let yPixelCoordinate = (reverseY / 100) * pieceHeight;
    let nX = (col * pieceWidth) + xPixelCoordinate;
    let nY = (row * pieceHeight) + yPixelCoordinate;
    return {
        xPixelCoordinate: nX,
        yPixelCoordinate: nY
    }
}

class TypeOnDesktop extends AgentTool {
    schema = z.object({
        keys: z.array(z.object({
            key: z.string().describe("The key to type."),
            action: z.enum(["typeKey", "pressKey", "releaseKey"]).describe(`The action to perform to a key. You can use any keys (including special keys) that are available in the nut-js library.`),
        })).describe("The keys to type."),
    });

    name: string = "sendKeybordInputToComputer";
    description: string = "Send keyboard presses to the computer.";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {

        for (const key of arg.keys) {
            let keyValue = Key[key.key as keyof typeof Key];

            if (!keyValue) {
                keyValue = Key[key.key.toUpperCase() as keyof typeof Key];
            }
            if (!keyValue) {
                keyboard.type(key.key);
                return {
                    text: "The keys have been sent to the computer.",
                }
            }
            if (key.action === "typeKey") {
                keyboard.type(keyValue);
            } else if (key.action === "pressKey") {
                keyboard.pressKey(keyValue);
            } else if (key.action === "releaseKey") {
                keyboard.releaseKey(keyValue);
            }
        }
        return {
            text: "The keys have been sent to the computer.",
        }
    }
}