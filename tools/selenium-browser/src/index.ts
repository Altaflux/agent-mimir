import { WebDriverManager } from "./driver-manager.js";

import { WebBrowserOptions } from "./driver-manager.js";
import { Embeddings } from "@langchain/core/embeddings";
import { WebBrowserTool, PassValueToInput, AskSiteQuestion, ClickWebSiteLinkOrButton } from "./tools.js";
import { MimirAgentPlugin, PluginContext, MimirPluginFactory } from "agent-mimir/schema";
import { AgentTool } from "agent-mimir/tools";
import { BaseLanguageModel } from "@langchain/core/language_models/base";

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
            new ClickWebSiteLinkOrButton(this.driverManager),
            new AskSiteQuestion(this.driverManager),
            new PassValueToInput(this.driverManager),
        ];
    }

    async clear(): Promise<void> {
        await this.driverManager.close();
    }

    tools(): AgentTool[] {
        return this.toolList;
    }
}
