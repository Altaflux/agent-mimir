
import { Tool } from "langchain/tools";
import { WebDriverManager } from "./driver-manager.js";
import { Toolkit } from "langchain/agents";
import { WebBrowserOptions } from "./driver-manager.js";
import { Embeddings } from "langchain/embeddings";
import { BaseLanguageModel } from "langchain/base_language";
import { WebBrowserTool, PassValueToInput, AskSiteQuestion, ClickWebSiteLinkOrButton } from "./tools.js";


export { WebDriverManager, SeleniumDriverOptions, WebBrowserOptions } from "./driver-manager.js";

export class WebBrowserToolKit extends Toolkit {

    tools: Tool[];

    constructor(config: WebBrowserOptions, model: BaseLanguageModel, embeddings: Embeddings) {
        super();
        const driverManager = new WebDriverManager(config, model, embeddings);
        this.tools = [
            new WebBrowserTool(driverManager),
            new ClickWebSiteLinkOrButton(driverManager),
            new AskSiteQuestion(driverManager),
            new PassValueToInput(driverManager),
        ];
    }
}

export function createWebBrowserTools(config: WebBrowserOptions, model: BaseLanguageModel, embeddings: Embeddings) : Tool[] {
    const driverManager = new WebDriverManager(config, model, embeddings);
    return [
        new WebBrowserTool(driverManager),
        new ClickWebSiteLinkOrButton(driverManager),
        new AskSiteQuestion(driverManager),
        new PassValueToInput(driverManager)
    ];
}
