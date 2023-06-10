
import { StructuredTool } from "langchain/tools";
import { WebDriverManager } from "./driver-manager.js";

import { WebBrowserOptions } from "./driver-manager.js";
import { Embeddings } from "langchain/embeddings";
import { BaseLanguageModel } from "langchain/base_language";
import { WebBrowserTool, PassValueToInput, AskSiteQuestion, ClickWebSiteLinkOrButton } from "./tools.js";

export { WebDriverManager, SeleniumDriverOptions, WebBrowserOptions } from "./driver-manager.js";
export { WebBrowserTool, PassValueToInput, AskSiteQuestion, ClickWebSiteLinkOrButton } from "./tools.js";

export class WebBrowserToolKit  {

    tools: StructuredTool[];

    constructor(config: WebBrowserOptions, model: BaseLanguageModel, embeddings: Embeddings) {
        const driverManager = new WebDriverManager(config, model, embeddings);
        this.tools = [
            new WebBrowserTool(driverManager),
            new ClickWebSiteLinkOrButton(driverManager),
            new AskSiteQuestion(driverManager),
            new PassValueToInput(driverManager),
        ];
    }
}
