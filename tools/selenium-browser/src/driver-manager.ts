
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { Document as VectorDocument } from 'langchain/document'
import { VectorStore } from "langchain/vectorstores/base";
import { Embeddings } from "langchain/embeddings/base";
import { Builder, ThenableWebDriver, logging } from 'selenium-webdriver';
import { BaseLanguageModel } from "langchain/base_language";
import { LLMChain } from "langchain/chains";
import { InteractableElement, extractHtml } from "./html-processor.js";
import { htmlToMarkdown } from "./to-markdown.js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore, } from "langchain/vectorstores/memory";
import { COMBINE_PROMPT } from "./prompt/combiner-prompt.js";
import { Options, update, } from 'webdriver-manager';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome.js';
import { Options as FireFoxOptions } from 'selenium-webdriver/firefox.js';
import { Options as EdgeOptions } from 'selenium-webdriver/edge.js';
import exitHook from 'async-exit-hook';
import { IS_RELEVANT_PROMPT } from "./prompt/relevance-prompt.js";
import { encode } from "gpt-3-encoder"


export type SeleniumDriverOptions = {
    browserName?: 'chrome' | 'firefox' | 'edge';
    disableHeadless?: boolean;
    driver?: ThenableWebDriver
}

export type WebBrowserOptions = {
    browserConfig: SeleniumDriverOptions
    maximumChunkSize?: number
    doRelevanceCheck?: boolean
    numberOfRelevantDocuments?: number | 'all'
}

const EMPTY_DOCUMENT_TAG = "(Empty the following piece is the beginning of the website)";

export class WebDriverManager {

    driver?: ThenableWebDriver;
    maximumChunkSize: number
    numberOfRelevantDocuments: number | 'all'
    relevanceCheck: boolean = false;
    vectorStore?: VectorStore;
    documents: VectorDocument[] = [];
    currentPage?: Document;
    interactableElements: Map<string, InteractableElement> = new Map();
    currentPageView?: string;

    constructor(private config: WebBrowserOptions, private model: BaseLanguageModel, private embeddings: Embeddings) {
        this.maximumChunkSize = config.maximumChunkSize || 3000;
        this.numberOfRelevantDocuments = config.numberOfRelevantDocuments || 2;
        this.relevanceCheck = config.doRelevanceCheck || false;

        exitHook(async (callback) => {
            await this.close();
            callback();
        });
    }

    async close() {
        await this.driver?.quit();
        this.driver = undefined;
    }

    async isActive() {
        return this.driver !== undefined;
    }
    async getDriver() {
        if (this.driver) {
            return this.driver;
        } else {
            const driverConfiguration = await configureDriver(this.config.browserConfig);
            await downloadDrivers(this.config.browserConfig?.browserName);
            let driver = driverConfiguration.build();
            this.driver = driver;
            return driver;
        }
    }

    async getScreenshot(): Promise<string> {
        let driver = await this.getDriver();
        const base64Image = await driver.takeScreenshot();
        return base64Image;
    }

    
    async getTitle(): Promise<string> {
        let driver = await this.getDriver();
        const title = await driver.getTitle();
        return title;
    }

    async navigateToUrl(url: string) {
        let driver = await this.getDriver();
        await driver!.get(url);
    }

    async getScreenDimensions() {
        const height: number = await this.driver?.executeScript("return window.innerHeight")!;
        const width: number = await this.driver?.executeScript("return window.innerWidth")!;
        return {
            height,
            width
        }
    }

    async getTotalPageDimensions() {
        const height: number = await this.driver?.executeScript("return (document.height !== undefined) ? document.height : document.body.offsetHeight")!;
        const width: number = await this.driver?.executeScript("return (document.width !== undefined) ? document.width : document.body.offsetWidth")!;
        return {
            height,
            width
        }
    }

    async calculateCurrentScrollBlock() {
        const viewDimensions = await this.getScreenDimensions();
        const totalDimensions = await this.getTotalPageDimensions();

        const scrollPosition =  await this.driver?.executeScript("return window.pageYOffset")! as number;
        const windowSize  = viewDimensions.height;
        const bodyHeight   = totalDimensions.height;
        const scrollPercentage = (scrollPosition / (bodyHeight - windowSize)) * 100;

        const actualPosition = (bodyHeight * scrollPercentage) / 100;

        const totalNumberOfBlocks = Math.ceil(bodyHeight / windowSize);
        const currentBlockPosition = Math.ceil(actualPosition / windowSize);

        return {
            totalBlocks: totalNumberOfBlocks,
            currentBlock: currentBlockPosition
        }
    }

    async refreshPageState() {
        let driver = await this.getDriver();
        let webPage = await extractHtml(await driver!.getPageSource(), driver);
        this.currentPage = webPage.html;
        this.interactableElements = webPage.interactableElements;

        const siteMarkdown = htmlToMarkdown(this.currentPage!);

        const textSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
            chunkSize: this.maximumChunkSize,
            chunkOverlap: 300,
            lengthFunction: (text) => encode(text).length
        });

        const texts = await textSplitter.splitText(siteMarkdown);
        const documents = texts.map((pageContent, index) => new VectorDocument({ pageContent: pageContent, metadata: { pageNumber: index } }));

        this.documents = documents;
        this.vectorStore = await MemoryVectorStore.fromDocuments(this.documents, this.embeddings);
    }

    async obtainSummaryOfPage(keywords: string, question: string, runManager?: CallbackManagerForToolRun) {
        let results;
        if (this.numberOfRelevantDocuments === 'all') {
            results = this.documents;
        }
        else if (!keywords || keywords === "") {
            results = this.documents.slice(0, this.numberOfRelevantDocuments);
        } else {
            const similaritySearchResults = await this.vectorStore!.similaritySearch(keywords, this.numberOfRelevantDocuments)
            results = similaritySearchResults.length > 0 ? similaritySearchResults : this.documents.slice(0, this.numberOfRelevantDocuments);
        }

        if (results.length === 1) {
            return results[0].pageContent;
        }

        const summarizedPageView = await this.combineDocuments(results
            .sort((doc1, doc2) => doc1.metadata.pageNumber - doc2.metadata.pageNumber)
            , question, runManager);

        if (this.relevanceCheck && !await this.isPageRelevant(summarizedPageView, question, runManager)) {
            return await this.combineDocuments(results
                .sort((doc1, doc2) => doc1.metadata.pageNumber - doc2.metadata.pageNumber)
                , "Important information on the site.", runManager);
        }
        ///Save the current view of the browser.
        this.currentPageView = summarizedPageView;
        return summarizedPageView;
    }


    private async isPageRelevant(page: string, question: string, runManager?: CallbackManagerForToolRun) {
        const llmChain = new LLMChain({ prompt: IS_RELEVANT_PROMPT, llm: this.model, verbose: false });
        const title = await this.driver!.getTitle()
        const llmResponse = (await llmChain.call({
            title: title,
            document: page,
            focus: question
        }, runManager?.getChild())).text;
        const result = llmResponse as string;
        const isRelevant = result.toLowerCase().match(/\btrue\b/g);
        return isRelevant != null;
    }

    private async combineDocuments(documents: VectorDocument[], question: string, runManager?: CallbackManagerForToolRun) {
        let focus = question;
        if (!question || question === "") {
            focus = "Main content of the page";
        }

        const title = await this.driver!.getTitle();
        return (await documents.map((doc) => Promise.resolve(doc))
            .reduce(async (prev, current) => {
                const previousDocument = await prev;
                const currentDocument = await current;
                if (encode((previousDocument.pageContent + currentDocument.pageContent)).length < this.maximumChunkSize) {
                    if (previousDocument.pageContent === EMPTY_DOCUMENT_TAG) {
                        return currentDocument;
                    }
                    return new VectorDocument({
                        pageContent: previousDocument.pageContent + "\n\n" + currentDocument.pageContent,
                        metadata: [],
                    });
                }
                const llmChain = new LLMChain({ prompt: COMBINE_PROMPT, llm: this.model, verbose: false });
                const result = ((await llmChain.call({
                    title: title,
                    document1: previousDocument.pageContent,
                    document2: currentDocument.pageContent,
                    focus: focus
                }, runManager?.getChild())).text as string);
                const shouldDiscard = result.substring(0, 15).toLowerCase().match(/\discard\b/g);
                if (shouldDiscard != null) {
                    return previousDocument;
                }
                return new VectorDocument({
                    pageContent: result,
                    metadata: [],
                });
            }, Promise.resolve(new VectorDocument({ pageContent: EMPTY_DOCUMENT_TAG, metadata: { pageNumber: 0 } })))).pageContent;
    }
}

const configureDriver = async (options: SeleniumDriverOptions) => {
    let builder = new Builder();
    switch (options.browserName) {
        case 'chrome': {
            builder = builder.forBrowser("chrome");
            if (!options.disableHeadless) {
                builder = builder.setChromeOptions(new ChromeOptions().addArguments('--headless=new'))
            }

            break
        }
        case 'firefox': {
            builder = builder.forBrowser("firefox");
            if (!options.disableHeadless) {
                builder = builder.setFirefoxOptions(new FireFoxOptions().headless())
            }
            break;
        }
        case 'edge': {
            builder = builder.forBrowser("MicrosoftEdge");
            if (!options.disableHeadless) {
                builder = builder.setEdgeOptions(new EdgeOptions().headless());
            }

            break;
        }
        default: {
            throw new Error(`Browser ${options.browserName} not supported`);
        }
    }
    const prefs = new logging.Preferences();
    prefs.setLevel(logging.Type.DRIVER, logging.Level.SEVERE);
    return builder.setLoggingPrefs(prefs);
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
    if (driverName) {
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
