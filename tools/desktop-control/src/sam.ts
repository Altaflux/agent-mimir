
import sharp from 'sharp';
import envPaths from 'env-paths';
import { ChildProcess, spawn } from 'child_process';
import path from "path";
import exitHook from 'async-exit-hook';
import net, { AddressInfo } from "net";
export type CoordinatesInfo = {
    masks: {
        coordinates: {
            x: number,
            y: number
        }
    }[]
}

export type Coordinates = {
    index: number,
    x: number,
    y: number
}[]



export type TextBlocks = {
    text: string,
    bbox: { 'x0': number, 'y0': number, 'x1': number, 'y1': number, 'x2': number, 'y2': number, 'x3': number, 'y3': number }
}[]




export class PythonServerControl {

    private process: ChildProcess | null = null;

    private port: number = 5000;

    async init() {
        console.log("Starting SAM server.")
        const dataDir = envPaths("mimir-desktop-control").data
        const pythonEnvironmentDir = path.join(dataDir, "pythonEnv");
        const scriptsDir = process.platform === "win32" ? 'Scripts' : 'bin';
        const activeScriptCall = process.platform === "win32" ? `activate` : `. ./activate`;
        const pythonServerScript = path.resolve(dataDir, 'server.py');
        const modelPath = path.resolve(dataDir, 'mobile_sam.pt');

        const port = await getPortFree();
        this.port = port;
        const command = `cd ${path.join(pythonEnvironmentDir, scriptsDir)} && ${activeScriptCall} && python ${pythonServerScript} --port ${port} --model ${modelPath}`;
        const result = spawn(command, [], { shell: true, env: process.env });

        result.stdout.pipe(process.stdout);
        result.stderr.pipe(process.stderr);

        this.process = result;

        exitHook(async (callback) => {
            console.log("Closing SAM server.")
            await this.close();
            callback();
        });
    }

    async close() {
        if (this.process) {
            this.process.kill("SIGINT")
            this.process = null;
        }
    }

    async addSam(screenshotImage: Buffer, textBlocks: TextBlocks) {


       // const textBlocks = await this.getTextBlocks(screenshotImage);
        const mask = await generateTextMask(screenshotImage, textBlocks);


        const screenshotImageWithoutText = await this.inpaint(screenshotImage, mask);


        const screenshotMetaData = await sharp(screenshotImage).metadata();

        const scaledWidth = 1024;
        const scaleRatio = screenshotMetaData.width! / scaledWidth;
        const resizedScreenshotWithoutText = await sharp(screenshotImageWithoutText).resize(scaledWidth).toBuffer();


        const coordinates = transformLabelCoordinates(await this.calculateMaskBoxes(resizedScreenshotWithoutText), scaleRatio);
        const labelsWithoutText = await addLabels(screenshotImage, coordinates);

        return {
            screenshot: labelsWithoutText,
            coordinates: coordinates,
        }
    }


    async inpaint(screenshotImage: Buffer, mask: Buffer) {

        const formData = new FormData();
        formData.append('image', new Blob([screenshotImage], { type: 'image/jpg' }))
        formData.append('inpaintMask', new Blob([mask], { type: 'image/jpg' }))

        const response = await fetch(`http://localhost:${this.port}/inpaint`, {
            method: 'POST',
            body: formData
        });

        const inpaintedImage = await response.blob();
        const inpaintedImageBuffer =  Buffer.from(await inpaintedImage.arrayBuffer());
        return inpaintedImageBuffer;
    }


    async calculateMaskBoxes(screenshotImage: Buffer) {
        const formData = new FormData();
        formData.append('image', new Blob([screenshotImage], { type: 'image/jpg' }))

        const response = await fetch(`http://localhost:${this.port}/calculate-boxes`, {
            method: 'POST',
            body: formData
        });

        const coordinates: CoordinatesInfo = await response.json();
        return coordinates;

    }

    transformLabelCoordinates(coordinates: CoordinatesInfo, scaleRatio: number): Coordinates {
        const newCoordinates = coordinates.masks.map((el, i) => {
            return {
                index: i,
                x: el.coordinates.x * scaleRatio,
                y: el.coordinates.y * scaleRatio
            }
        });
        return newCoordinates
    }


    async getTextBlocks(screenshotImage: Buffer) {

        const formData = new FormData();
        formData.append('image', new Blob([screenshotImage], { type: 'image/jpg' }))

        const response = await fetch(`http://localhost:${this.port}/obtainText`, {
            method: 'POST',
            body: formData
        });

        const coordinates: { textBoxes: TextBlocks } = await response.json();
        return coordinates.textBoxes;
    }
}



function transformLabelCoordinates(coordinates: CoordinatesInfo, scaleRatio: number): Coordinates {
    const newCoordinates = coordinates.masks.map((el, i) => {
        return {
            index: i,
            x: el.coordinates.x * scaleRatio,
            y: el.coordinates.y * scaleRatio
        }
    });
    return newCoordinates
}

function midpoint(x1: number, y1: number, x2: number, y2: number): [number, number] {
    const x_mid = ((x1 + x2) / 2)
    const y_mid = ((y1 + y2) / 2)
    return [x_mid, y_mid]
}

async function generateTextMask(buffer: Buffer, textBlocks: TextBlocks) {
    const sharpImage = sharp(buffer);

    const metadata = await sharpImage.metadata();
    const sharpImageBuffer = sharp({
        create: {
            width: metadata.width!,
            height: metadata.height!,
            channels: 3,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        }
    });
    const svgElements = [];
    for (const blocks of textBlocks) {
        const [x_mid0, y_mid0] = midpoint(blocks.bbox.x1, blocks.bbox.y1, blocks.bbox.x2, blocks.bbox.y2)
        const [x_mid1, y_mi1] = midpoint(blocks.bbox.x0, blocks.bbox.y0, blocks.bbox.x3, blocks.bbox.y3)

        const thickness = Math.floor((Math.sqrt((blocks.bbox.x2 - blocks.bbox.x1) ** 2 + (blocks.bbox.y2 - blocks.bbox.y1) ** 2)));

        svgElements.push(`<line x1="${x_mid0}" y1="${y_mid0}" x2="${x_mid1}" y2="${y_mi1}" stroke="white" stroke-width="${thickness}px"/>`);
    }
    const overlaySvg = `<svg height="100%" width="100%">${svgElements.join('')}</svg>`;

    try {
        const overlayBuffer = Buffer.from(overlaySvg);
        return await sharpImageBuffer
            .composite([{ input: overlayBuffer, top: 0, left: 0 }])
            .toFormat('jpg')
            .toBuffer();

    } catch (error) {
        throw error;
    }
}
async function addLabels(buffer: Buffer, coordinates: Coordinates) {
    const img = sharp(buffer);
    const metadata = await img.metadata();
    const width = metadata.width!;
    const height = metadata.height!;

    const svgElements: string[] = [];
    const blockWidth = width / 70;
    const blockHeight = height / 60;

    for (const [i, mask] of coordinates.entries()) {
        svgElements.push(`<svg width="${blockWidth}px" height="${blockHeight}px" preserveAspectRatio="xMinYMin" x="${mask.x}"  y="${mask.y}">
            <rect width="100%" height="100%" fill="white" fill-opacity="0.7" style="stroke-width:3;stroke:rgb(0,0,0)" /> 
            <text  x="50%" y="60%" width="100%" height="100%" text-anchor="middle"  alignment-baseline="central" font-family="monospace" dominant-baseline="central" font-weight="bold" font-size="${blockWidth / 2.5}px">${i}</text>
        
    </svg>`)
    }
    const overlaySvg = `<svg height="${height}" width="${width}">${svgElements.join('')}</svg>`;

    const overlayBuffer = Buffer.from(overlaySvg);
    return await img
        .composite([{ input: overlayBuffer, top: 0, left: 0 }])
        .toBuffer();
}

async function getPortFree(): Promise<number> {
    return new Promise(res => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const port = (srv.address()! as AddressInfo).port
            srv.close((err) => res(port))
        });
    })
}


