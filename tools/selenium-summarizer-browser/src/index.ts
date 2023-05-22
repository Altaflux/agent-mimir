import * as cheerio from "cheerio";
import { BaseLanguageModel } from "langchain/base_language";
import { LLMChain } from "langchain/chains";
import { CallbackManager, CallbackManagerForToolRun } from "langchain/callbacks";
import { Embeddings } from "langchain/embeddings";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Tool, ToolParams } from "langchain/tools";
import { MemoryVectorStore, } from "langchain/vectorstores/memory";
import { VectorStore } from "langchain/vectorstores";
import { Document } from 'langchain/document'
import { StringPromptValue } from "langchain/prompts";
import { loadSummarizationChain } from "langchain/chains";
import { Actions, Builder, By, ThenableWebDriver } from 'selenium-webdriver';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome.js';
import { Options as FireFoxOptions } from 'selenium-webdriver/firefox.js';
import { JSDOM } from 'jsdom';
import {
    Options,
    update,
} from 'webdriver-manager';
import { clickables } from "./html-cleaner.js";
import { REFINE_PROMPT, SUMMARY_PROMPT } from "./summary/prompt.js";
import { COMBINE_PROMPT } from "./summary/combiner-prompt.js";
import { RELEVANCE_PROMPT } from "./summary/relevance-prompt.js";


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


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Headers = Record<string, any>;

export interface WebBrowserArgs extends ToolParams {
    model: BaseLanguageModel;

    embeddings: Embeddings;

    headers?: Headers;

    /** @deprecated */
    callbackManager?: CallbackManager;

    seleniumDriverOptions?: SeleniumDriverOptions;
}




function findIDs(inputString: string) {
    var regex = /id="([^"]*)"/g;
    var result;
    var ids = [];

    while ((result = regex.exec(inputString)) !== null) {
        ids.push(result[1]);
    }

    return ids;
}

export class WebBrowserToolManager {

    driver?: ThenableWebDriver;
    vectorStore?: VectorStore;
    currentPage?: string;
    documents: {
        ids: string[],
        doc: Document
    }[] = [];
    cleanHtml?: string;
    inputs: {
        id: string,
        xpath: string,
        description: string,
        type: string,
        originalId: string | null,
    }[] = [];
    clickables: {
        id: string,
        xpath: string,
        originalId: string | null,
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
        const html = await driver!.getPageSource()
        let cleanHtml = await clickables(html, driver);
        this.cleanHtml = cleanHtml.html;
        this.clickables = cleanHtml.clickables;
        this.inputs = cleanHtml.inputs;

        const doc = new JSDOM(this.cleanHtml!).window.document;
        const allElements = doc.querySelectorAll('body');
        const body = allElements[0]?.outerHTML ?? "";
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 2500,
            chunkOverlap: 200,
        });
        const texts = await textSplitter.splitText(body);
        const docs = texts.map(
            (pageContent, index) =>
                new Document({
                    pageContent: `${pageContent}`,
                    metadata: [],
                })
        );

        this.documents = docs.map((doc) => {
            return {
                ids: findIDs(doc.pageContent),
                doc: doc
            }
        });

        let store = await MemoryVectorStore.fromDocuments(
            docs,
            this.embeddings
        );

        this.vectorStore = store;
        console.log("refreshed page state");
    }

    getBiggestFive(numbers: {
        relevant: number,
        doc: { ids: string[]; doc: Document<Record<string, any>>; };
    }[]): {
        relevant: number,
        doc: { ids: string[]; doc: Document<Record<string, any>>; };
    }[] {
        if (!numbers || numbers.length === 0) {
            return [];
        }

        // Sort the array in descending order
        let sortedNumbers = numbers.sort((a, b) => b.relevant - a.relevant);

        // Get the first five numbers
        return sortedNumbers.slice(0, 3);
    }

    async obtainSummaryOfPage(question: string, mode: SUMMARY_MODE = 'slow') {
        let results;
        if (!question || question === "") {
            results = [this.documents[1]?.doc ?? this.documents[0]?.doc];
        } else {
            //results = await this.vectorStore!.similaritySearch(question, 1);

            let fpp = (await Promise.all(await this.documents!.map(async (doc) => {
                const relevanceChain = new LLMChain({ llm: this.model, prompt: RELEVANCE_PROMPT });
                const result = (await relevanceChain.call({
                    document: doc.doc.pageContent,
                    focus: question,
                })).text as string;
                const elementId = Number(result.replace(/\D/g, ''));
                return {
                    relevant: elementId,
                    doc: doc
                }
            })));
            fpp = this.getBiggestFive(fpp);

            results = (fpp).map((doc) => doc.doc.doc);
            console.log(`Selected ${results.length} documents`);
        }

        let selectedDocs = await Promise.all(results.map(async (document) => {
            const location = this.documents.findIndex((doc) => doc.doc.pageContent === document.pageContent);
            const startingLocation = location > 0 ? location - 1 : 0;
            const selectedDocuments = this.documents.slice(startingLocation, startingLocation + 3);
            // const selectedDocuments = this.documents;
            const inputs = selectedDocuments.map((doc) => doc.ids).flat();
            return {
                document: new Document({
                    pageContent: await this.doSummary2(selectedDocuments.map((doc) => doc.doc), question),
                    metadata: [],
                }),
                ids: inputs
            }
        }));
        return selectedDocs[0].document.pageContent;

    }


    private async doSummary(docs: Document[], question: string) {
        let focus = question;
        if (!question || question === "") {
            focus = "Main content of the page";
        }
        const chain = loadSummarizationChain(this.model, { type: "refine", refinePrompt: REFINE_PROMPT, questionPrompt: SUMMARY_PROMPT });

        const res = await chain.call({
            input_documents: docs,
            focus: focus
        });
        const result = res.output_text;
        return result as string;
    }

    private async doSummary2(docs: Document[], question: string) {
        let focus = question;
        if (!question || question === "") {
            focus = "Main content of the page";
        }
        if (docs.length <= 1) {
            return docs[0].pageContent;
        }

        const res = await docs.map((doc) => Promise.resolve(doc))
            .reduce(async (prev, current) => {
                const llmChain = new LLMChain({ prompt: COMBINE_PROMPT, llm: this.model, verbose: false });
                const document1 = (await prev).pageContent;
                const document2 = (await current).pageContent;
                const result = (await llmChain.call({
                    document1: document1,
                    document2: document2,
                    focus: focus
                })).text;
                return new Document({
                    pageContent: result,
                    metadata: [],
                });
            });

        return res.pageContent;
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
        const clickableElement1 = this.toolManager.clickables.find((c) => c.id === elementId);
        const clickableElement2 = this.toolManager.inputs.find((c) => c.id === elementId);
        const clickableElement = clickableElement1 ?? clickableElement2;
        if (!clickableElement) {
            return "Button or link not found for id: " + baseUrl;
        }
        const byExpression = clickableElement.originalId ? By.id(clickableElement.originalId) : By.xpath(clickableElement.xpath);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            try {
                await driver.actions().move({ origin: elementFound }).click().perform();
                // await driver.actions().move({ origin: elementFound }).click().perform();
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
        const clickableElement = this.toolManager.inputs.find((c) => c.id === elementId);
        if (!clickableElement) {
            return "Button or link not found for id: " + baseUrl;
        }
        const byExpression = clickableElement.originalId ? By.id(clickableElement.originalId) : By.xpath(clickableElement.xpath);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            await driver.actions().move({ origin: elementFound }).clear()
            await driver.actions().move({ origin: elementFound }).sendKeys(task).perform();
            await delay(4000);
            // await this.toolManager.refreshPageState();
            // const result = await this.toolManager.obtainSummaryOfPage(task, 'slow');
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