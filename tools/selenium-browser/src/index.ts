import { WebDriverManager } from "./driver-manager.js";

import { WebBrowserOptions } from "./driver-manager.js";
import { Embeddings } from "@langchain/core/embeddings";
import { WebBrowserTool, PassValueToInput, AskSiteQuestion, ClickWebSiteLinkOrButton, ScrollTool } from "./tools.js";
import { MimirAgentPlugin, PluginContext, MimirPluginFactory, NextMessage, AdditionalContent } from "agent-mimir/schema";
import { AgentTool } from "agent-mimir/tools";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChainValues } from "@langchain/core/utils/types";
import { promises as fs } from "fs";

export { WebDriverManager, SeleniumDriverOptions, WebBrowserOptions } from "./driver-manager.js";
export { WebBrowserTool, PassValueToInput, AskSiteQuestion, ClickWebSiteLinkOrButton } from "./tools.js";


export class WebBrowserPluginFactory implements MimirPluginFactory {

    name: string = "webBrowser";

    constructor(private config: WebBrowserOptions, private model: BaseLanguageModel, private embeddings: Embeddings) {
    }

    create(context: PluginContext): MimirAgentPlugin {
        return new WebBrowserPlugin(this.config, this.model, this.embeddings);
    }

}

class WebBrowserPlugin extends MimirAgentPlugin {

    driverManager: WebDriverManager;
    toolList: AgentTool[];
    constructor(config: WebBrowserOptions, model: BaseLanguageModel, embeddings: Embeddings) {
        super();
        this.driverManager = new WebDriverManager(config, model, embeddings);
        this.toolList = [
            new WebBrowserTool(this.driverManager),
            new ScrollTool(this.driverManager),
            new ClickWebSiteLinkOrButton(this.driverManager),
            new AskSiteQuestion(this.driverManager),
            new PassValueToInput(this.driverManager),
        ];
    }

    async additionalMessageContent(message: NextMessage, inputs: ChainValues): Promise<AdditionalContent> {

        if (!this.driverManager.currentPage) {
            return {
                persistable: false,
                content: [
                ]
            }
        }
        await this.driverManager.refreshPageState();
        const screenshot = await this.driverManager.getScreenshot();
        const title = await this.driverManager.getTitle();

        const result = await this.driverManager.obtainSummaryOfPage("", "");

        return {
            persistable: false,
            content: [
                {
                    type: "text",
                    text: `The following image is a screenshot of the browser which is currently at page ${title}:`
                },
                {
                    type: "image_url",
                    image_url: {
                        type: "png",
                        url: screenshot
                    }
                },
                {
                    type: "text",
                    text: `The following image is a page summary in markdown format of the website in the browser. You can use the IDs in the elements to click or type on them:\n\n${result}`
                },
            ]
        }

    }

    async clear(): Promise<void> {
        await this.driverManager.close();
    }

    tools(): AgentTool[] {
        return this.toolList;
    }
}
