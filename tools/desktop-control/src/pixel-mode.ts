import { ComplexMessageContent } from "@mimir/agent-core/schema";
import { AgentTool } from "@mimir/agent-core/tools";
import { ToolResponse } from "@mimir/agent-core/tools";
import screenshot from 'screenshot-desktop';
import si from 'systeminformation';
import { mouse, Point } from "@nut-tree-fork/nut-js";
import sharp from 'sharp';
import { z } from "zod/v4";
import { MouseMode } from "./mouse-mode.js";
import { getComputerScreenImage } from "./screen.js";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

type PixelScreenshotContext = {
    sourceWidth?: number;
    sourceHeight?: number;
    resizedWidth?: number;
    resizedHeight?: number;
}

export type PixelMouseModeOptions = {
    imageWidth: number;
}

export class PixelMouseMode implements MouseMode {

    private readonly context: PixelScreenshotContext = {};

    constructor(private readonly options: PixelMouseModeOptions) {
    }

    async init(): Promise<void> {

    }

    async reset(): Promise<void> {

    }

    async destroy(): Promise<void> {

    }

    instructionsMessage(): string {
        return `You can also use "moveMouseLocationOnComputerScreenPixel" to move the mouse to specific x/y pixel coordinates from the resized screenshot image.`
    }

    async getScreenshot(): Promise<{ content: ComplexMessageContent[], finalImage: Buffer }> {
        await new Promise(r => setTimeout(r, 1000));
        const computerScreenshot = await getComputerScreenImage();

        const originalMetadata = await sharp(computerScreenshot).metadata();
        const resizedImage = await sharp(computerScreenshot).resize({ width: this.options.imageWidth }).toBuffer();
        const resizedMetadata = await sharp(resizedImage).metadata();

        this.context.sourceWidth = originalMetadata.width!;
        this.context.sourceHeight = originalMetadata.height!;
        this.context.resizedWidth = resizedMetadata.width!;
        this.context.resizedHeight = resizedMetadata.height!;

        const imageWithPixelGrid = await addPixelGuideGrid(resizedImage, this.context.resizedWidth, this.context.resizedHeight);

        const imageOutputDirectory = "C:\\AI\\mimir";
        await mkdir(imageOutputDirectory, { recursive: true });
        
        await writeFile(join(imageOutputDirectory, "final-image.jpg"), imageWithPixelGrid);


        const content: ComplexMessageContent[] = [
            {
                type: "text" as const,
                text: `Screenshot of the computer's screen resized to ${this.context.resizedWidth}x${this.context.resizedHeight}. Use x/y pixel coordinates from this ${this.context.resizedWidth}x${this.context.resizedHeight} image when calling "moveMouseLocationOnComputerScreenPixel". The thin guide grid marks x pixel values along the top and bottom edges and y pixel values along the left and right edges.`
            },
            {
                type: "image" as const,
                mimeType: "image/jpeg" as const,
                data: imageWithPixelGrid.toString("base64")
            }
        ];

        return {
            finalImage: imageWithPixelGrid,
            content
        }
    }

    async getTools(): Promise<(AgentTool)[]> {
        return [new MoveMouseToPixel(this.context)]
    }
}

async function addPixelGuideGrid(image: Buffer, width: number, height: number): Promise<Buffer> {
    const majorStep = chooseGridStep(Math.max(width, height));
    const minorStep = majorStep / 2;
    const fontSize = Math.max(10, Math.min(18, Math.floor(width / 70)));
    const labelPadding = 3;
    const edgeLabelInset = fontSize + labelPadding;
    const svgElements: string[] = [];

    for (let x = 0; x < width; x += minorStep) {
        const isMajor = x % majorStep === 0;
        svgElements.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="white" stroke-opacity="${isMajor ? 0.35 : 0.18}" stroke-width="${isMajor ? 1 : 0.5}"/>`);
    }

    for (let y = 0; y < height; y += minorStep) {
        const isMajor = y % majorStep === 0;
        svgElements.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="white" stroke-opacity="${isMajor ? 0.35 : 0.18}" stroke-width="${isMajor ? 1 : 0.5}"/>`);
    }

    for (let x = 0; x < width; x += majorStep) {
        const labelX = clamp(x, edgeLabelInset, width - edgeLabelInset);
        svgElements.push(edgeLabel(labelX, fontSize + labelPadding, x.toString(), fontSize, "middle"));
        svgElements.push(edgeLabel(labelX, height - labelPadding, x.toString(), fontSize, "middle"));
    }

    for (let y = 0; y < height; y += majorStep) {
        const labelY = clamp(y, edgeLabelInset, height - edgeLabelInset);
        svgElements.push(edgeLabel(labelPadding, labelY, y.toString(), fontSize, "start"));
        svgElements.push(edgeLabel(width - labelPadding, labelY, y.toString(), fontSize, "end"));
    }

    const overlaySvg = `<svg height="${height}" width="${width}">${svgElements.join('')}</svg>`;
    return await sharp(image)
        .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
        .toBuffer();
}

function edgeLabel(x: number, y: number, text: string, fontSize: number, anchor: "start" | "middle" | "end") {
    return `<text x="${x}" y="${y}"
        font-size="${fontSize}"
        font-family="Arial, Helvetica Neue, sans-serif"
        font-weight="700"
        fill="black"
        stroke="white"
        stroke-width="2"
        paint-order="stroke"
        text-anchor="${anchor}"
        dominant-baseline="middle">${text}</text>`;
}

function chooseGridStep(maxDimension: number) {
    if (maxDimension <= 800) {
        return 100;
    }
    if (maxDimension <= 1400) {
        return 128;
    }
    return 200;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

class MoveMouseToPixel extends AgentTool {

    constructor(private readonly context: PixelScreenshotContext) {
        super();
    }

    schema = z.object({
        x: z.number().int().describe("The x pixel coordinate from the resized screenshot image."),
        y: z.number().int().describe("The y pixel coordinate from the resized screenshot image."),
        reason: z.string().describe("The reason these x/y coordinates were selected."),
    })

    name: string = "moveMouseLocationOnComputerScreenPixel";
    description: string = "Move the mouse to a location using x/y pixel coordinates from the resized screenshot image.";

    protected async _call(arg: z.input<this["schema"]>): Promise<ToolResponse> {
        const { sourceWidth, sourceHeight, resizedWidth, resizedHeight } = this.context;
        if (!sourceWidth || !sourceHeight || !resizedWidth || !resizedHeight) {
            return [
                {
                    type: "text",
                    text: "Pixel screenshot context is not available yet. Please use the current screenshot context before calling this tool.",
                },
            ]
        }

        if (arg.x < 0 || arg.x >= resizedWidth || arg.y < 0 || arg.y >= resizedHeight) {
            return [
                {
                    type: "text",
                    text: `The pixel coordinates must be within the resized screenshot bounds: x between 0 and ${resizedWidth - 1}, y between 0 and ${resizedHeight - 1}.`,
                },
            ]
        }

        const screenshotX = Math.floor((arg.x / resizedWidth) * sourceWidth);
        const screenshotY = Math.floor((arg.y / resizedHeight) * sourceHeight);
        const desktopLocation = await convertScreenshotPixelToDesktopPixel(screenshotX, screenshotY);

        console.log(`Moving mouse to pixel coordinate: ${desktopLocation.x}, ${desktopLocation.y}`);
        await mouse.setPosition(new Point(desktopLocation.x, desktopLocation.y));

        return [
            {
                type: "text",
                text: `The mouse has moved to the new pixel location: (x${arg.x},y${arg.y}), please make sure the mouse has moved to your desired location (look at the computer screen image), if that is not the case try again using different x/y pixel coordinates.`,
            },
        ]
    }
}

async function convertScreenshotPixelToDesktopPixel(screenshotX: number, screenshotY: number): Promise<{ x: number, y: number }> {
    const graphics = await si.graphics();
    const displays = await screenshot.listDisplays();
    const mainDisplay = (displays.find((el) => (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]).deviceName === el.name) ?? displays[0]) as { id: number; name: string, height: number, width: number };
    const mainScreen = graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0];

    return {
        x: Math.floor(((((mainScreen.resolutionX ?? 0) / mainDisplay.width) * 100) * screenshotX) / 100),
        y: Math.floor(((((mainScreen.resolutionY ?? 0) / mainDisplay.height) * 100) * screenshotY) / 100),
    }
}
