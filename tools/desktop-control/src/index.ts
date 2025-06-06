import { ComplexMessageContent, } from "agent-mimir/schema";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { z } from "zod";

import { ToolResponse } from "agent-mimir/tools";
import { AgentTool } from "agent-mimir/tools";
import screenshot, { DisplayID } from 'screenshot-desktop';
import si from 'systeminformation';
import { Key, keyboard, mouse, Button, Point } from "@nut-tree-fork/nut-js";
import sharp from 'sharp';
import { Coordinates, PythonServerControl, TextBlocks } from "./sam.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AdditionalContent, AgentPlugin, PluginFactory, NextMessageUser, PluginContext, AgentSystemMessage } from "agent-mimir/plugins";
import Fuse from 'fuse.js';
import { MolmoServerControl } from "./molmo.js";

type MyAtLeastOneType = 'SOM' | 'COORDINATES' | 'TEXT';
type DesktopContext = {
    coordinates: Coordinates
    textBlocks: TextBlocks
}
export type DesktopControlOptions = {
    mouseMode: [MyAtLeastOneType, ...MyAtLeastOneType[]]
    model?: BaseChatModel
}

export class DesktopControlPluginFactory implements PluginFactory {

    name: string = "desktopControl";

    constructor(private options: DesktopControlOptions) {

    }

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new DesktopControlPlugin(context, this.options);
    }
}

class DesktopControlPlugin extends AgentPlugin {

    private gridSize = 1;

    private pythonServer: PythonServerControl = new PythonServerControl();

    private molmoServer: MolmoServerControl = new MolmoServerControl();

    private readonly desktopContext: DesktopContext = {
        coordinates: [],
        textBlocks: []
    };

    constructor(private context: PluginContext, private options: DesktopControlOptions) {
        super();

    }
    async getSystemMessages(): Promise<AgentSystemMessage> {

        return {
            content: [

                {
                    type: "text",
                    text: `\nComputer Control Instruction:\n You can control the computer by moving the mouse, clicking and typing. Make sure to pay close attention to the details provided in the screenshot image to confirm the outcomes of the actions you take to ensure accurate completion of tasks. 
You can also use "moveMouseLocationOnComputerScreenGridCell" to move the mouse to a specific grid cell on the screen.`
                },

            ]
        }
    }
    async init(): Promise<void> {
        await this.pythonServer.init()
        //await this.molmoServer.init()
    }

    async reset(): Promise<void> {
        await this.pythonServer.close()
        //await this.molmoServer.close()
    }

    async additionalMessageContent(message: NextMessageUser): Promise<AdditionalContent[]> {
        const { content, finalImage } = await this.generateComputerImageContent();
        // const sharpImage = sharp(finalImage);
        //   const metadata = await sharpImage.metadata();
        //const resizedImage = await sharpImage.resize({ width: Math.floor(metadata.width! * (30 / 100)) }).toBuffer();

        return [
            {
                saveToChatHistory: 2,
                displayOnCurrentMessage: false,
                content: [
                    {
                        type: "text",
                        text: "The image of the user's computer screen is displayed below."
                    },
                    {
                        type: "image_url",
                        image_url: {
                            type: "jpeg",
                            url: finalImage.toString("base64")
                        }
                    }
                ]
            },
            {
                saveToChatHistory: false,
                displayOnCurrentMessage: true,
                content: content
            }
        ]
    }

    async generateComputerImagePromptAndUpdateState(): Promise<{ tiled: Buffer, finalImage: Buffer }> {
        await new Promise(r => setTimeout(r, 1000));
        const computerScreenshot = await getComputerScreenImage();
        const tiles = await getScreenTiles(computerScreenshot, true);

        let textBlocks: TextBlocks = []
        if (this.options.mouseMode.includes('SOM') || this.options.mouseMode.includes('TEXT')) {
            textBlocks = await this.pythonServer.getTextBlocks(tiles.originalImage);
        }
        this.desktopContext.textBlocks = textBlocks;

        const labeledImage = this.options.mouseMode.includes('SOM')
            ? await this.pythonServer.addSam(tiles.originalImage, textBlocks)
            : { screenshot: tiles.originalImage, coordinates: [] };

        //const sharpFinalImage = sharp(labeledImage.screenshot);
        this.desktopContext.coordinates = labeledImage.coordinates;

        //const sharpFinalImage = sharp(labeledImage.screenshot);
        // const metadata = await sharpFinalImage.metadata();
        //const finalImage = await sharpFinalImage.resize({ width: Math.floor(metadata.width! * (70 / 100)) }).toBuffer();



        return {
            tiled: tiles.tiled,
            finalImage: labeledImage.screenshot
        }
    }

    async generateComputerImageContent(): Promise<{ content: ComplexMessageContent[], finalImage: Buffer }> {
        const { finalImage, tiled } = await this.generateComputerImagePromptAndUpdateState();


        const sharpFinalImage = sharp(finalImage);
        const finalImageMetadata = await sharpFinalImage.metadata();
        const finalImageResized = await sharpFinalImage.resize({ width: Math.floor(finalImageMetadata.width! * (70 / 100)) }).toBuffer();


        const sharpTiledImage = sharp(tiled);
        const finalTiledImageMetadata = await sharpTiledImage.metadata();
        const finalTiledImageResized = await sharpTiledImage.resize({ width: Math.floor(finalTiledImageMetadata.width! * (70 / 100)) }).toBuffer();



        const tilesMessage = this.options.mouseMode.includes('COORDINATES') ? [
            {
                type: "text" as const,
                text: `This image includes a grid of cells with numbers to help you identify the coordinates of the computer screen.If you want to use this coordinates use the "moveMouseLocationOnComputerScreenGridCell" tool to move the mouse to a specific location on the screen.`
            },
            {
                type: "image_url" as const,
                image_url: {
                    type: "jpeg" as const,
                    url: finalTiledImageResized.toString("base64")
                },
            },
        ] : [
            {
                type: "text" as const,
                text: `Screenshot of the computer's screen. Before you proceed to use the tools, make sure to pay close attention to the details provided in the image to confirm the outcomes of the actions you take to ensure accurate completion of tasks.`
            },
            {
                type: "image_url" as const,
                image_url: {
                    type: "jpeg" as const,
                    url: finalImageResized.toString("base64")
                }
            }
        ];



        return {
            finalImage: finalImage,
            content: [
                ...tilesMessage,

            ]
        }
    }


    async tools(): Promise<AgentTool[]> {
        // const screenshot = async () => { return await this.generateComputerImageContent() };
        const screenshot = async () => { return [] };
        const mouseTools = [];
        if (this.options.mouseMode.includes('COORDINATES')) {
            mouseTools.push(new MoveMouseToCoordinate(screenshot, this.gridSize, this.molmoServer));
        }
        if (this.options.mouseMode.includes('SOM')) {

            mouseTools.push(new MoveMouseToLabel(screenshot, this.desktopContext));
        }
        if (this.options.mouseMode.includes('TEXT')) {
            mouseTools.push(new MoveMouseToText(screenshot, this.desktopContext));
        }

        return [
            ...mouseTools,
            //new GetImageOfDesktop(screenshot),
            new ClickPositionOnDesktop(screenshot),
            new TypeTextOnDesktop(screenshot),
            new TypeOnDesktop(screenshot),
            new ScrollScreen(),
        ]
    };
}


async function addMouse(strurcturedImage: sharp.Sharp) {
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


    const metadata = await strurcturedImage.metadata();
    const width = metadata.width;
    const height = metadata.height;
    const overlaySvg = `<svg  height="${height}" width="${width}">${mouseIcon}</svg>`;
    const overlayBuffer = Buffer.from(overlaySvg);
    strurcturedImage = strurcturedImage
        .composite([{ input: overlayBuffer, top: 0, left: 0 }])

    return strurcturedImage;
}

async function drawGridForTile(imageBuffer: Buffer) {
    const primeImage = sharp(imageBuffer)
    const metadata = await primeImage.metadata();
    const width = metadata.width!;
    const height = metadata.height!;

    const cellsX = 37;
    const cellsY = 27;
    const cellWidth = width / cellsX;
    const cellHeight = height / cellsY;

    const svgElements = [];

    let counter = 0;
    for (let y = 0; y < cellsY; y++) {
        for (let x = 0; x < cellsX; x++) {
            if (counter > 999) break;

            const xPos = x * cellWidth;
            const yPos = y * cellHeight;

            // Add semi-transparent white background for each cell
            svgElements.push(`<rect x="${xPos}" y="${yPos}" width="${cellWidth}" height="${cellHeight}" 
                fill="white" fill-opacity="0.3" stroke="gray" stroke-width="1"/>`);

            // Add text with outline
            const fontSize = Math.min(cellWidth * 0.4, cellHeight * 0.4);
            svgElements.push(`<text x="${xPos + cellWidth / 2}" y="${yPos + cellHeight / 2}" 
                font-size="${fontSize}"
                font-family="Arial, Helvetica Neue, sans-serif"
                font-weight="700"
                fill="black"
                stroke="white"
                stroke-width="2"
                paint-order="stroke"
                text-anchor="middle" 
                dominant-baseline="middle">${counter}</text>`);

            counter++;
        }
    }

    const overlaySvg = `<svg height="${height}" width="${width}">${svgElements.join('')}</svg>`;

    try {
        const overlayBuffer = Buffer.from(overlaySvg);
        const img = primeImage
            .composite([{ input: overlayBuffer, top: 0, left: 0 }])
        return img.toBuffer();

    } catch (error) {
        throw error;
    }
}


async function getComputerScreenImage(displayMouse: boolean = true) {

    const graphics = await si.graphics();
    const displays = await screenshot.listDisplays();
    const mainGraphics = (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]);
    const mainDisplay = (displays.find((el) => (mainGraphics).deviceName === el.name) ?? displays[0]) as { id: number; name: string, height: number, width: number };
    const screenshotImage = sharp(await screenshot({ screen: mainDisplay.id, format: 'jpg' }));


    const imageWithMouse = await addMouse(screenshotImage);
    const meta = await imageWithMouse.metadata();
    // const mainGraphics =  (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]);
    // const rezised = imageWithMouse.resize({ width: mainGraphics.resolutionX! })
    const asBuffer = await imageWithMouse.toBuffer();
    return asBuffer;
}

async function getScreenTiles(screenshot: Buffer, displayMouse: boolean) {

    const screenshotImage = sharp(screenshot);

    const tiledImage = await drawGridForTile(await screenshotImage.toBuffer())

    const fullImage = await screenshotImage
        // .toFormat('jpeg')
        // .jpeg({
        //     quality: 100,
        //     chromaSubsampling: '4:4:4',
        //     force: true,
        // })
        .toBuffer();

    return {
        originalImage: fullImage,
        tiled: tiledImage
    };
}

class MoveMouseToLabel extends AgentTool {

    constructor(private readonly getScreenFunc: () => Promise<ComplexMessageContent[]>, private context: DesktopContext) {
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
                ... await this.getScreenFunc()
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
            ... await this.getScreenFunc()
        ]
    }
}

class MoveMouseToText extends AgentTool {

    constructor(private readonly getScreenFunc: () => Promise<ComplexMessageContent[]>, private context: DesktopContext) {
        super();
    }

    schema = z.object({
        elementDescription: z.string().describe("A description of the element to which you are moving the mouse over."),
        location: z.object({
            elementText: z.string().describe("The exact text in the button or link to click. Include ONLY the text to locate.")
        }),
    })

    name: string = "moveMouseLocationOnComputerScreenToTextLocation";
    description: string = "Move the mouse to a location on the computer screen. This tool is preferred over the \"moveMouseLocationOnComputerScreenToCoordinate\" tool, but if you are not succeeding try using then try the \"moveMouseLocationOnComputerScreenToCoordinate\" tool. Use as input the text on the element to which you are want to move the mouse over. The text must be as precise as possible!";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {

        const symbols = this.context.textBlocks.filter((el) => el.text.trim() !== '');

        ///TEST
        const fullTextIntact = symbols.map((symbol) => symbol.text).join(' ').toLowerCase();
        const searchKeywordIntact = arg.location.elementText.toLowerCase();
        const result = findFuzzyMatch(fullTextIntact, searchKeywordIntact);

        if (result === null) {
            return [
                {
                    type: "text",
                    text: "Could not find the element to which move the mouse to, please try again by using the \"moveMouseLocationOnComputerScreenToCoordinate\" tool.",
                }
            ]
        }
        const searchLocation = fullTextIntact.slice(0, result!.startIndex).split(" ").length - 1;
        const startingLocation = symbols[searchLocation].bbox;
        const endingLocation = symbols[searchLocation + result!.matchedText.split(" ").length - 1].bbox;

        const graphics = await si.graphics();
        const displays = await screenshot.listDisplays();
        const mainDisplay = (displays.find((el) => (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]).deviceName === el.name) ?? displays[0]) as { id: number; name: string, height: number, width: number };

        const x = startingLocation.x0 + (endingLocation.x1 - startingLocation.x0) / 2;
        const y = startingLocation.y0 + (endingLocation.y1 - startingLocation.y0) / 2;

        const mainScreen = graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0];
        const scaledX = Math.floor(((((mainScreen.resolutionX ?? 0) / mainDisplay.width) * 100) * x) / 100);
        const scaledY = Math.floor(((((mainScreen.resolutionY ?? 0) / mainDisplay.height) * 100) * y) / 100);

        const location = convertToPixelCoordinates2(mainScreen.resolutionX ?? 0, mainScreen.resolutionY ?? 0, scaledX, scaledY, 1, 1);
        await mouse.setPosition(new Point(location.xPixelCoordinate, location.yPixelCoordinate));

        return [
            {
                type: "text",
                text: "The mouse has moved to the new location, please be sure the mouse has moved to the expected location (look at the computer screen image), if that is not the case try again with a different \"text\" value or use the \"moveMouseLocationOnComputerScreenToCoordinate\" tool. .",
            },
            ... await this.getScreenFunc()
        ]
    }
}


function findFuzzyMatch(paragraph: string, searchPhrase: string) {
    // Split the paragraph into overlapping chunks
    const chunks = [];
    const words = paragraph.split(' ');

    // Create chunks of 3 words (or however many words are in your search phrase)
    const searchWordCount = searchPhrase.split(' ').length;

    for (let i = 0; i <= words.length - searchWordCount; i++) {
        const chunk = words.slice(i, i + searchWordCount).join(' ');
        chunks.push({
            text: chunk,
            startIndex: words.slice(0, i).join(' ').length + (i > 0 ? 1 : 0)
        });
    }

    // Configure Fuse options
    const options = {
        includeScore: true,
        threshold: 0.4, // Adjust this value to control fuzzy matching sensitivity
        keys: ['text']
    };

    const fuse = new Fuse(chunks, options);
    const results = fuse.search(searchPhrase);

    if (results.length > 0) {
        // Return the best match
        return {
            matchedText: results[0].item.text,
            startIndex: results[0].item.startIndex,
            score: results[0].score
        };
    }

    return null;
}
class MoveMouseToCoordinate extends AgentTool {

    constructor(private readonly getScreenFunc: () => Promise<ComplexMessageContent[]>, private gridSize: number, private molmo: MolmoServerControl) {
        super();
    }

    schema = z.object({
        elementDescription: z.string().describe("A description of the element to which you are moving the mouse over."),
        gridCellNumber: z.number().int().describe("The cell number of the piece of the grid screen to click on."),

    })

    name: string = "moveMouseLocationOnComputerScreenGridCell";
    description: string = "Move the mouse to a location on the computer screen. Use the cell numbers on the computer screen to choose to which location to move the mouse.";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {

        if (arg.gridCellNumber < 0 || arg.gridCellNumber > 999) {
            return [
                {
                    type: "text",
                    text: `The tile number must be between 1 and ${this.gridSize}`,
                },
                ... await this.getScreenFunc()
            ]
        }

        const graphics = await si.graphics();
        const mainScreen = graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0];
        const cords = getTileCenterCoordinates(mainScreen.resolutionX ?? 0, mainScreen.resolutionY ?? 0, arg.gridCellNumber);
        console.log(`Moving mouse to: ${cords.x}, ${cords.y}`);
        await mouse.setPosition(new Point(cords.x, cords.y));

        try {
            const screenshot = await getComputerScreenImage();
            const coordsAsPercentage = {
                x: Math.floor((cords.x / (mainScreen.resolutionX ?? 0)) * 100),
                y: Math.floor((cords.y / (mainScreen.resolutionY ?? 0)) * 100)
            };
            const newCoords = await this.molmo.locateItem(screenshot, arg.elementDescription, mainScreen.resolutionX ?? 0, mainScreen.resolutionY ?? 0, coordsAsPercentage);

            await mouse.setPosition(new Point(newCoords.x, newCoords.y));
        } catch (e) {
            console.error(e);
        }



        return [
            {
                type: "text",
                text: "The mouse has moved to the new location, please make sure the mouse has moved to the correct location (look at the computer screen image), if that is not the case try again using different cell grid number.",
            },
            ... await this.getScreenFunc()
        ]
    }

}


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
class ClickPositionOnDesktop extends AgentTool {

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

function convertToPixelCoordinates(
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

    const row = Math.floor((tileNumber - 1) / gridSize);
    const col = Math.ceil((tileNumber - 1) % gridSize);

    let xPixelCoordinate = (xPercentageCoordinate / 100) * pieceWidth;
    let yPixelCoordinate = (reverseY / 100) * pieceHeight;
    let nX = (col * pieceWidth) + xPixelCoordinate;
    let nY = (row * pieceHeight) + yPixelCoordinate;
    return {
        xPixelCoordinate: nX,
        yPixelCoordinate: nY
    }
}
class TypeTextOnDesktop extends AgentTool {
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


class ScrollScreen extends AgentTool {
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


class TypeOnDesktop extends AgentTool {
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
