import { ComplexMessageContent, } from "agent-mimir/schema";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { z } from "zod";

import { ToolResponse } from "agent-mimir/tools";
import { AgentTool } from "agent-mimir/tools";
import screenshot, { DisplayID } from 'screenshot-desktop';
import si from 'systeminformation';
// import { JsonSchema7ObjectType } from "zod-to-json-schema";
// import { zodToJsonSchema } from "zod-to-json-schema";

import { Key, keyboard, mouse, Button, Point } from "@nut-tree-fork/nut-js";
import sharp from 'sharp';

// import { LLMChain } from "langchain/chains";

// import { simpleParseJson } from "agent-mimir/utils/json";
import { Coordinates, PythonServerControl, TextBlocks } from "./sam.js";
import { ChatPromptTemplate, renderTemplate } from "@langchain/core/prompts";
import { HumanMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AdditionalContent, AgentPlugin, PluginFactory, NextMessageUser, PluginContext, AgentSystemMessage } from "agent-mimir/plugins";
import Fuse from 'fuse.js';

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
There are multiple ways to move the mouse, the screen's image includes labels of white boxes with numbers on top of elements you can click, you can move the mouse to the element being labeled by it by using the "moveMouseLocationOnComputerScreenToLabel" tool.
You can also use "moveMouseLocationOnComputerScreenToTextLocation" to move the mouse to a specific piece of text. And you can also use "moveMouseLocationOnComputerScreenToCoordinate" to move the mouse to a specific coordinate on the screen.`
                },

            ]
        }
    }
    async init(): Promise<void> {
        await this.pythonServer.init()
    }

    async reset(): Promise<void> {
        await this.pythonServer.close()
    }

    async additionalMessageContent(message: NextMessageUser): Promise<AdditionalContent[]> {
        const { content, finalImage } = await this.generateComputerImageContent();
        const sharpImage = sharp(finalImage);
        const metadata = await sharpImage.metadata();
        const resizedImage = await sharpImage.resize({ width: Math.floor(metadata.width! * (30 / 100)) }).toBuffer();
        // const computerImages = await this.generateComputerImagePrompt();
        return [
            {
                saveToChatHistory: true,
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
                            url: resizedImage.toString("base64")
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
        // return []
    }

    async generateComputerImagePromptAndUpdateState(): Promise<{ tiles: Buffer[], finalImage: Buffer }> {
        await new Promise(r => setTimeout(r, 1000));
        const computerScreenshot = await getComputerScreenImage();
        const tiles = await getScreenTiles(computerScreenshot, this.gridSize, true);

        let textBlocks: TextBlocks = []
        if (this.options.mouseMode.includes('SOM') || this.options.mouseMode.includes('TEXT')) {
            textBlocks = await this.pythonServer.getTextBlocks(tiles.originalImage);
        }
        this.desktopContext.textBlocks = textBlocks;

        //  const labeledImage = await this.pythonServer.addSam(tiles.originalImage, textBlocks);
        const labeledImage = this.options.mouseMode.includes('SOM')
            ? await this.pythonServer.addSam(tiles.originalImage, textBlocks)
            : { screenshot: tiles.originalImage, coordinates: [] };

        const sharpFinalImage = sharp(labeledImage.screenshot);
        this.desktopContext.coordinates = labeledImage.coordinates;


        const metadata = await sharpFinalImage.metadata();
        const finalImage = await sharpFinalImage.resize({ width: Math.floor(metadata.width! * (70 / 100)) }).toBuffer();



        return {
            tiles: tiles.tiles,
            finalImage: finalImage
        }
    }

    async generateComputerImageContent(): Promise<{ content: ComplexMessageContent[], finalImage: Buffer }> {
        const { finalImage, tiles } = await this.generateComputerImagePromptAndUpdateState();


        const tilesMessage = this.options.mouseMode.includes('COORDINATES') ? [
            {
                type: "text" as const,
                text: `This images are the tiles of pieces of the user's computer's screen. They include a red plot overlay and there tile number to help you identify the coordinates of the screen. In total there are ${this.gridSize} tile images. `
            },
            ...tiles.map((tile) => {
                return {
                    type: "image_url" as const,
                    image_url: {
                        type: "jpeg" as const,
                        url: tile.toString("base64")
                    },

                }
            })
        ] : [];



        return {
            finalImage: finalImage,
            content: [
                {
                    type: "text",
                    text: `Screenshot of the computer's screen. Before you proceed to use the tools, make sure to pay close attention to the details provided in the image to confirm the outcomes of the actions you take to ensure accurate completion of tasks.`
                },
                {
                    type: "image_url",
                    image_url: {
                        type: "jpeg",
                        url: finalImage.toString("base64")
                    }
                },
                {
                    type: "text",
                    text: "--------------------------------\n\n"
                },
                ...tilesMessage,
                {
                    type: "text",
                    text: "--------------------------------\n\n"
                },
            ]
        }
    }

    async generateComputerImagePrompt(): Promise<ComplexMessageContent[]> {

        // await new Promise(r => setTimeout(r, 1000));
        // const computerScreenshot = await getComputerScreenImage();
        // const tiles = await getScreenTiles(computerScreenshot, this.gridSize, true);
        // const labeledImage = await this.pythonServer.addSam(tiles.originalImage);

        // const sharpFinalImage = sharp(labeledImage.screenshot);
        // const metadata = await sharpFinalImage.metadata();
        // const finalImage = await sharpFinalImage.resize({ width: Math.floor(metadata.width! * (70 / 100)) }).toBuffer();
        // this.desktopContext.coordinates = labeledImage.coordinates;
        // this.desktopContext.textBlocks = labeledImage.textBlocks;

        const { finalImage, tiles } = await this.generateComputerImagePromptAndUpdateState();

        const tilesMessage = this.options.mouseMode.includes('COORDINATES') ? [
            {
                type: "text" as const,
                text: `This images are the tiles of pieces of the user's computer's screen. They include a red plot overlay and there tile number to help you identify the coordinates of the screen. In total there are ${this.gridSize} tile images. If you want to use this coordinates use the "moveMouseLocationOnComputerScreenToCoordinate" tool to move the mouse to a specific location on the screen.`
            },
            ...tiles.map((tile) => {
                return {
                    type: "image_url" as const,
                    image_url: {
                        type: "jpeg" as const,
                        url: tile.toString("base64")
                    },

                }
            })
        ] : [];

        return [
            {
                type: "text",
                text: `\nThis image is the user's computer's screen, you can use the labels and text on this image to move the mouse around by using the appropriate tools.`
            },
            {
                type: "image_url",
                image_url: {
                    type: "jpeg",
                    url: finalImage.toString("base64")
                }
            },
            ...tilesMessage,
            {
                type: "text",
                text: "--------------------------------\n\n"
            },

        ]
    }

    async tools(): Promise<AgentTool[]> {
        // const screenshot = async () => { return await this.generateComputerImageContent() };
        const screenshot = async () => { return [] };
        const mouseTools = [];
        if (this.options.mouseMode.includes('COORDINATES')) {
            mouseTools.push(new MoveMouseToCoordinate(screenshot, this.gridSize, this.options.model!));
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

    svgElements.push(`<text x="${width / 2}" y="${padding - 60}" font-size="35" fill="red">Tile Number: ${imageNumber}</text>`);
    for (let i = 0; i <= 100; i = i + 10) {
        // Calculate positions for lines and text, offset by padding
        const x = (i / 10) * lineSpacingX + padding;
        const y = (i / 10) * lineSpacingY + padding;

        // Vertical lines and numbering
        svgElements.push(`<line x1="${x}" y1="${padding}" x2="${x}" y2="${height + padding}" stroke="red" stroke-width="2"/>`);
        svgElements.push(`<text x="${x - 10}" y="${height + padding + 40}" font-size="35" fill="red">${i}</text>`);

        // Horizontal lines and numbering
        svgElements.push(`<line x1="${padding}" y1="${y}" x2="${width + padding}" y2="${y}" stroke="red" stroke-width="2"/>`);

        const reverseValue = (i - 100) * -1;
        svgElements.push(`<text x="${padding - 60}" y="${y + 5}" font-size="35" fill="red">${reverseValue}</text>`);


        let initialY = padding;
        for (let j = 0; j <= 100; j = j + 10) {
            const secondReverseValue = (j - 100) * -1;
            svgElements.push(`<text x="${x}" y="${initialY}" font-size="25" fill="red">(${i}, ${secondReverseValue})</text>`);
            initialY = initialY + lineSpacingY;
        }

    }

    const overlaySvg = `<svg height="${paddedHeight}" width="${paddedWidth}">${svgElements.join('')}</svg>`;
    try {
        const overlayBuffer = Buffer.from(overlaySvg);
        const img = await primeImage
            .extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .composite([{ input: overlayBuffer, top: 0, left: 0 }])
            .toFormat('jpeg')
            .jpeg({
                quality: 100,
                chromaSubsampling: '4:4:4',
                force: true, // <----- add this parameter
            });
        const metadata = await img.metadata()
        return img.toBuffer();

    } catch (error) {
        throw error;
    }
}

async function getComputerScreenImage() {

    const graphics = await si.graphics();
    const displays = await screenshot.listDisplays();
    const mainDisplay = (displays.find((el) => (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]).deviceName === el.name) ?? displays[0]) as { id: number; name: string, height: number, width: number };
    const screenshotImage = sharp(await screenshot({ screen: mainDisplay.id, format: 'png' }));

    return await screenshotImage.toBuffer();
}

async function getScreenTiles(screenshot: Buffer, numberOfPieces: number, displayMouse: boolean, drawGrid: boolean = true) {

    const screenshotImage = sharp(screenshot);

    let sharpImage = sharp(displayMouse ? await addMouse(screenshotImage) : await screenshotImage.toBuffer())

    const metadata = await sharpImage.metadata()!;
    const gridSize = Math.sqrt(numberOfPieces);

    const pieceWidth = metadata.width! / gridSize;
    const pieceHeight = metadata.height! / gridSize;
    // Extract and save each piece
    let tiles = [];
    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            const left = col * pieceWidth;
            const top = row * pieceHeight;
            const img = sharpImage.clone()
                .extract({ left: Math.floor(left), top: Math.floor(top), width: Math.floor(pieceWidth), height: Math.floor(pieceHeight) });
            const finalImage = drawGrid ? await drawGridForTile(await img.toBuffer(), row * gridSize + col + 1) : await img.toBuffer();

            tiles.push(finalImage);
        }
    }
    const fullImage = await sharpImage
        .toFormat('jpeg')
        .jpeg({
            quality: 100,
            chromaSubsampling: '4:4:4',
            force: true,
        })
        .toBuffer();

    return {
        originalImage: fullImage,
        tiles: tiles
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

    constructor(private readonly getScreenFunc: () => Promise<ComplexMessageContent[]>, private gridSize: number, private model: BaseChatModel) {
        super();
    }

    schema = z.object({
        elementDescription: z.string().describe("A description of the element to which you are moving the mouse over."),
        coordinates: z.object({
            tileNumber: z.number().int().describe("The tile number of the piece of the screen to click on."),
            xCoordinate: z.number().int().min(1).max(100).describe("The x axis coordinate of the of the position of the click on the screen, the axis can be any value between 1 and 100."),
            yCoordinate: z.number().int().min(1).max(100).describe("The y axis coordinate of the of the position of the click on the screen, the axis can be any value between 1 and 100."),
        }).describe("The coordinates of the click on the screen, be as precise as possible!"),

    })

    name: string = "moveMouseLocationOnComputerScreenToCoordinate";
    description: string = "Move the mouse to a location on the computer screen. Any x and y coordinates value inside the graph is valid, be as precise as possible!";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {

        if (arg.coordinates.tileNumber > this.gridSize) {
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
        const location = convertToPixelCoordinates(mainScreen.resolutionX ?? 0, mainScreen.resolutionY ?? 0, arg.coordinates.xCoordinate, arg.coordinates.yCoordinate, arg.coordinates.tileNumber, this.gridSize);
        console.log(`Moving mouse to: ${arg.coordinates.xCoordinate}, ${arg.coordinates.yCoordinate}`);
        await mouse.setPosition(new Point(location.xPixelCoordinate, location.yPixelCoordinate));

        // try {
        //     const newCoordinates = await this.veryifyMousePosition(arg.coordinates.tileNumber, arg.elementDescription, { x: arg.coordinates.xCoordinate, y: arg.coordinates.yCoordinate });
        //     const newLocation = convertToPixelCoordinates(mainScreen.resolutionX ?? 0, mainScreen.resolutionY ?? 0, newCoordinates.x, newCoordinates.y, arg.coordinates.tileNumber, this.gridSize);
        //     await mouse.setPosition(new Point(newLocation.xPixelCoordinate, newLocation.yPixelCoordinate));

        // } catch (error) {
        //     console.warn("Error verifying mouse position.", error);
        // }
        return [
            {
                type: "text",
                text: "The mouse has moved to the new location, please make sure the mouse has moved to the expected location (look at the computer screen image), if that is not the case try again using different coordinates.",
            },
            ... await this.getScreenFunc()
        ]
    }

    //     private async veryifyMousePosition(tileNumber: number, elementDescription: string, existingCoordinates: { x: number, y: number }): Promise<{ x: number, y: number }> {

    //         const tiles = await getScreenTiles(await getComputerScreenImage(), this.gridSize, false);
    //         const specificTile = tiles.tiles[tileNumber - 1];

    //         const responseSchema = z.object({
    //             elementFound: z.boolean().describe("A boolean value indicating if you were able to find the element."),
    //             coordinates: z.object({
    //                 xCoordinate: z.number().int().min(1).max(100).describe("The x axis coordinate of the of the position of the click on the screen, the axis can be any value between 1 and 100."),
    //                 yCoordinate: z.number().int().min(1).max(100).describe("The y axis coordinate of the of the position of the click on the screen, the axis can be any value between 1 and 100."),
    //             }).nullable().describe("The coordinates of the element on the screen, be as precise as possible!")

    //         });

    //         const instrucction = `From the given image verify the existence and location of the following element: \"{elementDescription}\"

    // Return the correct coordinates of location of the element, use x and y coordinates value as shown in the graph drawn over the image.

    // IMPORTANT! Your response must be conformed with the following JSON schema:
    // \`\`\`json
    // {tool_schema}
    // \`\`\`

    // Example of a valid response when the element is found:
    // \`\`\`json
    // {{
    //     "elementFound": true,
    //     "coordinates": {{
    //         "xCoordinate": 34,
    //         "yCoordinate": 76
    //     }}
    // }}
    // \`\`\`

    // Example of a valid response when the element not is found:
    // \`\`\`json
    // {{
    //     "elementFound": false,
    //     "coordinates": null
    // }}
    // \`\`\`

    // -----------------
    // Your JSON response:
    // `;
    //         const renderedHumanMessage = renderTemplate(instrucction, "f-string", {
    //             tool_schema: JSON.stringify(
    //                 (zodToJsonSchema(responseSchema) as JsonSchema7ObjectType).properties
    //             ),
    //             elementDescription: elementDescription,
    //             previousCoordinates: `x${existingCoordinates.x}, y${existingCoordinates.y}`
    //         });

    //         const instructionMessage = new HumanMessage({
    //             content: [
    //                 {
    //                     type: "text",
    //                     text: renderedHumanMessage
    //                 },
    //                 {
    //                     type: "image_url",
    //                     image_url: `data:image/png;base64,${specificTile.toString("base64")}`
    //                 }
    //             ]
    //         });

    //         const messagePrompt = ChatPromptTemplate.fromMessages([instructionMessage]);
    //         const chain: LLMChain<string> = new LLMChain({
    //             llm: this.model,
    //             prompt: messagePrompt,
    //         });

    //         const functionResponse = await chain.predict({
    //             tool_schema: JSON.stringify(
    //                 (zodToJsonSchema(responseSchema) as JsonSchema7ObjectType).properties
    //             )
    //         });

    //         let newCoordinates: z.infer<typeof responseSchema> = {
    //             elementFound: true,
    //             coordinates: {
    //                 xCoordinate: existingCoordinates.x,
    //                 yCoordinate: existingCoordinates.y
    //             }
    //         };
    //         try {
    //             newCoordinates = responseSchema.parse((await simpleParseJson(functionResponse)));
    //         } catch (error) {
    //             console.warn("Error parsing coordinates.", error);
    //         }

    //         console.log(`Element Description: ${elementDescription}, New coordinates:  ${newCoordinates.coordinates?.xCoordinate}, ${newCoordinates.coordinates?.yCoordinate}`)

    //         if (newCoordinates.elementFound === false) {
    //             return {
    //                 x: existingCoordinates.x,
    //                 y: existingCoordinates.y
    //             }
    //         }
    //         return {
    //             x: newCoordinates?.coordinates?.xCoordinate ?? 0,
    //             y: newCoordinates.coordinates?.yCoordinate ?? 0
    //         }

    //     }
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
class TypeOnDesktop extends AgentTool {
    schema = z.object({
        keys: z.array(z.object({
            key: z.string().describe("The key to type."),
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
                await keyboard.type(key.key);

                return [
                    {
                        type: "text",
                        text: "The keys have been sent to the computer.",
                    }
                ]
            }
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
