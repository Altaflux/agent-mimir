import { WebDriverManager } from "./driver-manager.js";
import { WebBrowserOptions } from "./driver-manager.js";
import { Embeddings } from "@langchain/core/embeddings";
import { WebBrowserTool, PassValueToInput, ClickWebSiteLinkOrButton, ScrollTool } from "./tools.js";
import { AgentPlugin, PluginContext, PluginFactory, NextMessageUser, AdditionalContent, NextMessage } from "@mimir/agent-core/plugins";
import { AgentTool } from "@mimir/agent-core/tools";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import sharp from "sharp";
import { InteractableElement } from "html-processor.js";

export { WebDriverManager, SeleniumDriverOptions, WebBrowserOptions } from "./driver-manager.js";
export { WebBrowserTool, PassValueToInput, AskSiteQuestion, ClickWebSiteLinkOrButton } from "./tools.js";


export class WebBrowserPluginFactory implements PluginFactory {

    name: string = "webBrowser";

    constructor(private config: WebBrowserOptions, private model: BaseLanguageModel, private embeddings: Embeddings) {
    }

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new WebBrowserPlugin(this.config, this.model, this.embeddings, context);
    }

}

class WebBrowserPlugin extends AgentPlugin {

    driverManager: WebDriverManager;
    toolList: AgentTool[];
    constructor(private config: WebBrowserOptions, model: BaseLanguageModel, embeddings: Embeddings, private context: PluginContext) {
        super();
        this.driverManager = new WebDriverManager(config, model, embeddings);
        this.toolList = [
            new WebBrowserTool(this.driverManager),
            new ScrollTool(this.driverManager),
            new ClickWebSiteLinkOrButton(this.driverManager),
            new PassValueToInput(this.driverManager),
        ];
    }

    async readyToProceed(message: NextMessage): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }


    async additionalMessageContent(message: NextMessageUser): Promise<AdditionalContent[]> {

        if (!await this.driverManager.isActive()) {
            return []
        }

        const screenshot = await this.driverManager.getScreenshot();
        await this.driverManager.refreshPageState();
        const title = await this.driverManager.getTitle();
        const realDimensions = await this.driverManager.getScreenDimensions();
        const resizedImaged = await resizeToDimensions(Buffer.from(screenshot, "base64"), realDimensions);
        const imageWithLabels = await addLabels(resizedImaged, this.driverManager.interactableElements);

        const result = await this.driverManager.obtainSummaryOfPage("", "");
        const resultWithoutIds = removeIdAttribute(result);
        const currentScrollBlock = await this.driverManager.calculateCurrentScrollBlock();

        return [
            {
                saveToChatHistory: false,
                displayOnCurrentMessage: true,
                content: [
                    {
                        type: "text",
                        text: `The following image is a screenshot of the browser which is currently at page ${title}:`
                    },
                    {
                        type: "image_url",
                        image_url: {
                            type: "png",
                            url: imageWithLabels.toString("base64")
                        }
                    }
                ]
            },
            {
                saveToChatHistory: true,
                displayOnCurrentMessage: false,
                content: [
                    {
                        type: "text",
                        text: `The following is a page summary in markdown format of the website in the browser.:\n\nSTART OF SITE MARKDOWN:\n${resultWithoutIds}\n\nEND OF SITE MARKDOWN\n\n`
                    },

                ]
            },
            {
                saveToChatHistory: false,
                displayOnCurrentMessage: true,
                content: [

                    {
                        type: "text",
                        text: `The following is a page summary in markdown format of the website in the browser. You can use the IDs in the elements to click or type on them:\n\nSTART OF SITE MARKDOWN:\n${result}\n\nEND OF SITE MARKDOWN\n\n`
                    },
                    {
                        type: "text",
                        text: `You are currently viewing part "${currentScrollBlock.currentBlock}" of "${currentScrollBlock.totalBlocks}", you can use the scroll tool to view other parts of the page.`
                    },
                ]
            }
        ]

    }

    async reset(): Promise<void> {
        await this.driverManager.close();
    }

    async tools(): Promise<AgentTool[]> {
        return this.toolList;
    }
}
async function resizeToDimensions(buffer: Buffer, dimensions: { width: number, height: number }) {
    const img = sharp(buffer);
    return await img.resize(dimensions.width, dimensions.height)
        .toBuffer();
}

async function addLabels(buffer: Buffer, coordinates: Map<string, InteractableElement>) {
    const img = sharp(buffer);
    const metadata = await img.metadata();
    const width = metadata.width!;
    const height = metadata.height!;

    const svgElements: string[] = [];
    const blockWidth = width / 50;
    const blockHeight = height / 40;

    for (const [i, mask] of coordinates.entries()) {
        svgElements.push(`<svg width="${blockWidth}px" height="${blockHeight}px" preserveAspectRatio="xMinYMin" x="${mask.location.left}"  y="${mask.location.top}">
            <rect width="100%" height="100%" fill="white" fill-opacity="0.7" style="stroke-width:3;stroke:rgb(0,0,0)" /> 
            <text x="50%" y="60%" width="100%" height="100%" text-anchor="middle"  alignment-baseline="central" font-family="monospace" dominant-baseline="central" font-weight="bold" font-size="${blockWidth / 2.5}px">${i}</text>
        
    </svg>`)
    }
    const overlaySvg = `<svg height="${height}" width="${width}">${svgElements.join('')}</svg>`;

    const overlayBuffer = Buffer.from(overlaySvg);
    return await img
        .composite([{ input: overlayBuffer, top: 0, left: 0 }])
        .toBuffer();
}

function removeIdAttribute(str: string) {
    return str.replace(/id="\d+"/g, '');
}