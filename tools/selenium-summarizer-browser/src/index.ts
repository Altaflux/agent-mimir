import { BaseLanguageModel } from "langchain/base_language";
import { LLMChain } from "langchain/chains";
import { CallbackManager, CallbackManagerForToolRun } from "langchain/callbacks";
import { Embeddings } from "langchain/embeddings";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Tool, ToolParams } from "langchain/tools";
import { MemoryVectorStore, } from "langchain/vectorstores/memory";
import { VectorStore } from "langchain/vectorstores";
import { Document as LangVector} from 'langchain/document'
import { loadSummarizationChain } from "langchain/chains";
import {  Builder, By, ThenableWebDriver } from 'selenium-webdriver';
import { JSDOM } from 'jsdom';
import {
    Options,
    update,
} from 'webdriver-manager';
import { clickables } from "./html-cleaner.js";
import { REFINE_PROMPT, SUMMARY_PROMPT } from "./summary/prompt.js";
import { COMBINE_PROMPT } from "./summary/combiner-prompt.js";
import { RELEVANCE_PROMPT } from "./summary/relevance-prompt.js";
import { htmlToMarkdown } from "./to-markdown.js";


export type SeleniumDriverOptions = {
    browserName?: 'chrome' | 'firefox' | 'safari' | 'edge';
    driver?: ThenableWebDriver
}
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const configureDriver = async (options: SeleniumDriverOptions) => {
    let builder = new Builder();
    switch (options.browserName) {
        case 'chrome': {
            builder = builder.forBrowser("chrome")
            //  .setChromeOptions(new ChromeOptions().addArguments('--headless=new'))

            break
        }
        case 'firefox': {
            builder = builder.forBrowser("firefox")
            //   .setFirefoxOptions(new FireFoxOptions().headless())

            break;
        }
        default: {
            throw new Error(`Browser ${options.browserName} not supported`);
        }
    }

    return builder;
}

const downloadDrivers = async (browserName: string | undefined) => {
    let driverName: "chromedriver" | "geckodriver" | undefined = undefined;
    if (!browserName) {
        return;
    }
    switch (browserName) {
        case 'chrome': {
            driverName = 'chromedriver'
            break
        }
        case 'firefox': {
            driverName = 'geckodriver'
            break;
        }
    }
    if (!driverName) {
        try {
            const optionsSel: Options = {
                browserDrivers: [{ name: driverName }]
            };
            await update(optionsSel);
        } catch (e) {
            console.warn(`Failed to download web driver ${driverName}`, e);
        }
    }
}




export interface WebBrowserArgs extends ToolParams {
    model: BaseLanguageModel;

    embeddings: Embeddings;


    /** @deprecated */
    callbackManager?: CallbackManager;

    seleniumDriverOptions?: SeleniumDriverOptions;
}




export class WebBrowserToolManager {

    driver?: ThenableWebDriver;
    vectorStore?: VectorStore;
    currentPage?: string;
    documents: LangVector[] = [];
    cleanHtml?: Document;
    clickables: {
        id: string,
        xpath: string,
    }[] = [];

    constructor(private seleniumDriverOptions: SeleniumDriverOptions, private model: BaseLanguageModel, private embeddings: Embeddings) {


    }

    async getDriver() {
        if (this.driver) {
            return this.driver;
        } else {
            const driverConfiguration = await configureDriver(this.seleniumDriverOptions);
            await downloadDrivers(this.seleniumDriverOptions.browserName);
            let driver = driverConfiguration.build();
            await driver.manage().setTimeouts({
                pageLoad: 120000,
            });
            this.driver = driver;
            return driver;
        }
    }

    async navigateToUrl(url: string) {
        let driver = await this.getDriver();
        await driver!.get(url);
        await driver!.wait(async (wd) => {
            let state = await wd.executeScript("return document.readyState");
            return state === 'complete';
        });
        await delay(4000);
        this.currentPage = url;
        await this.refreshPageState()
    }

    async refreshPageState() {
        let driver = await this.getDriver();
        let cleanHtml = await clickables(await driver!.getPageSource(), driver);
        this.cleanHtml = cleanHtml.html;
        this.clickables = cleanHtml.clickables;

        const siteMarkdown = htmlToMarkdown(this.cleanHtml!);
        const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 2500, chunkOverlap: 200 });
        const texts = await textSplitter.splitText(siteMarkdown);
        const documents = texts.map((pageContent) => new LangVector({ pageContent: pageContent }));

        let store = await MemoryVectorStore.fromDocuments(this.documents, this.embeddings);

        this.documents = documents;
        this.vectorStore = store;

    }

    async calculateRelevanceByPrompt(question: string, maxEntries: number = 5) {
        return (await Promise.all(this.documents!.map(async (doc) => {
            const relevanceChain = new LLMChain({ llm: this.model, prompt: RELEVANCE_PROMPT });
            const result = (await relevanceChain.call({
                document: doc.pageContent,
                focus: question,
            })).text as string;
            const relevance = Number(result.replace(/\D/g, ''));
            return {
                relevant: relevance,
                doc: doc
            }
        })))
        .sort((a, b) => b.relevant - a.relevant)
        .slice(0, maxEntries);
    }

    async getDocumentsBySimilarity(question: string, maxEntries: number = 5) {
       return await this.vectorStore!.similaritySearch(question, maxEntries);
    }
    

    async obtainSummaryOfPage(question: string, mode: SUMMARY_MODE = 'slow') {
        let results;
        if (!question || question === "") {
            results = [this.documents[1] ?? this.documents[0]];
        } else {
            results = (await this.calculateRelevanceByPrompt(question, 4))
                .map((doc) => doc.doc);
        }

        let selectedDocs = await Promise.all(results.map(async (document) => {
            const location = this.documents.findIndex((doc) => doc.pageContent === document.pageContent);
            const startingLocation = location > 0 ? location - 1 : 0;
            const selectedDocuments = this.documents.slice(startingLocation, startingLocation + 3);
            return {
                document: new LangVector({
                    pageContent: await this.doSummary2(selectedDocuments, question),
                    metadata: [],
                })
            }
        }));

        return await this.doSummary2(selectedDocs.map((doc) => doc.document), question);
    }



    private async doSummary2(documents: LangVector[], question: string) {
        let focus = question;
        if (!question || question === "") {
            focus = "Main content of the page";
        }

        return (await documents.map((doc) => Promise.resolve(doc))
            .reduce(async (prev, current) => {
                const llmChain = new LLMChain({ prompt: COMBINE_PROMPT, llm: this.model, verbose: false });
                const result = (await llmChain.call({
                    document1: (await prev).pageContent,
                    document2: (await current).pageContent,
                    focus: focus
                })).text;

                return new LangVector({
                    pageContent: result,
                    metadata: [],
                });
            })).pageContent;
    }
}



type SUMMARY_MODE = 'fast' | 'slow' | number;

export class NWebBrowserTool extends Tool {
    constructor(private toolManager: WebBrowserToolManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const [baseUrl, task] = inputs.split(",").map((input: string) => {
            let t = input.trim();
            t = t.startsWith('"') ? t.slice(1) : t;
            t = t.endsWith('"') ? t.slice(0, -1) : t;
            // it likes to put / at the end of urls, wont matter for task
            t = t.endsWith("/") ? t.slice(0, -1) : t;
            return t.trim();
        });
        let formattedBaseUrl = baseUrl;
        if (!formattedBaseUrl.startsWith("http://") && !formattedBaseUrl.startsWith("https://")) {
            formattedBaseUrl = "https://" + formattedBaseUrl;
        }
        await this.toolManager.navigateToUrl(formattedBaseUrl);
        const driver = await this.toolManager.getDriver();
        const result = await this.toolManager.obtainSummaryOfPage(task, 'slow');
        return `You are currently in page: ${await driver.getTitle()}\n ${result}`;
    }
    name = "navigate-to-website";
    description = `useful for when you need to find something on or summarize a webpage. input should be a comma seperated list of "ONE valid http URL including protocol","what you want to find on the page in plain english in the form of a question.".`;

}

export class ClickWebSiteLinkOrButton extends Tool {
    constructor(private toolManager: WebBrowserToolManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        if (!this.toolManager.currentPage) {
            return "You are not in any website at the moment, navigate into one using: click-website-link-or-button";
        }
        const [baseUrl, task] = inputs.split(",").map((input: string) => {
            let t = input.trim();
            t = t.startsWith('"') ? t.slice(1) : t;
            t = t.endsWith('"') ? t.slice(0, -1) : t;
            // it likes to put / at the end of urls, wont matter for task
            t = t.endsWith("/") ? t.slice(0, -1) : t;
            return t.trim();
        });
        const elementId = baseUrl.replace(/\D/g, '');
        const driver = await this.toolManager.getDriver();
        const clickableElement = this.toolManager.clickables.find((c) => c.id === elementId);

        if (!clickableElement) {
            return "Button or link not found for id: " + baseUrl;
        }
        const byExpression = By.xpath(clickableElement.xpath);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            try {
                await driver.actions().move({ origin: elementFound }).click().perform();
                await delay(4000);
                await this.toolManager.refreshPageState();
                const result = await this.toolManager.obtainSummaryOfPage(task, 'slow');
                return `You are currently in page: ${await driver.getTitle()}\n ${result}`;
            } catch (e) {
                return "Click failed for id: " + baseUrl;
            }

        } else {
            return "Button or link not found for id: " + baseUrl;
        }
    }
    name = "click-website-link-or-button";
    description = `useful for when you need to click on an element from the current page you are on. input should be a comma seperated list of "ONE valid id of a link or button","what information are you looking for.".`;

}

export class PassValueToInput extends Tool {
    constructor(private toolManager: WebBrowserToolManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        if (!this.toolManager.currentPage) {
            return "You are not in any website at the moment, navigate into one using: click-website-link-or-button";
        }
        const [baseUrl, task] = inputs.split(",").map((input: string) => {
            let t = input.trim();
            t = t.startsWith('"') ? t.slice(1) : t;
            t = t.endsWith('"') ? t.slice(0, -1) : t;
            // it likes to put / at the end of urls, wont matter for task
            t = t.endsWith("/") ? t.slice(0, -1) : t;
            return t.trim();
        });


        const elementId = baseUrl.replace(/\D/g, '');
        const driver = await this.toolManager.getDriver();
        const clickableElement = this.toolManager.clickables.find((c) => c.id === elementId);
        if (!clickableElement) {
            return "Button or link not found for id: " + baseUrl;
        }
        const byExpression = By.xpath(clickableElement.xpath);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            await driver.actions().move({ origin: elementFound }).clear()
            await driver.actions().move({ origin: elementFound }).sendKeys(task).perform();
            return `Input's value has been updated successfully.`;
        } else {
            return "Input not found for id: " + baseUrl;
        }
    }
    name = "set-value-in-page-input";
    description = `useful for when you need to set a value to an input type element from the current page you are on. input should be a comma seperated list of "ONE valid id of a input","the value to set to the input.".`;

}


export class AskSiteQuestion extends Tool {
    constructor(private toolManager: WebBrowserToolManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const result = await this.toolManager.obtainSummaryOfPage(inputs, 'fast');
        return result;
    }
    name = "look-information-on-current-page";
    description = `useful for when you need to find more information in the site you are currently on. input should be what information are you looking for.`;

}