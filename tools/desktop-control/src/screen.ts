import screenshot, { DisplayID } from 'screenshot-desktop';
import si from 'systeminformation';
import { mouse } from "@nut-tree-fork/nut-js";
import sharp from 'sharp';

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

export async function getComputerScreenImage(displayMouse: boolean = true) {

    const graphics = await si.graphics();
    const displays = await screenshot.listDisplays();
    const mainGraphics = (graphics.displays.find((ui) => ui.main === true) ?? graphics.displays[0]);
    const mainDisplay = (displays.find((el) => (mainGraphics).deviceName === el.name) ?? displays[0]) as { id: number; name: string, height: number, width: number };
    const screenshotImage = sharp(await screenshot({ screen: mainDisplay.id, format: 'jpg' }));

    const imageWithMouse = displayMouse ? await addMouse(screenshotImage) : screenshotImage;

    const asBuffer = await imageWithMouse.toBuffer();
    return asBuffer;
}

export async function getScreenTiles(screenshot: Buffer) {

    const screenshotImage = sharp(screenshot);

    const tiledImage = await drawGridForTile(await screenshotImage.toBuffer())

    const fullImage = await screenshotImage
        .toBuffer();

    return {
        originalImage: fullImage,
        tiled: tiledImage
    };
}
