
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { Document as VectorDocument } from 'langchain/document'
import { LLMChain } from "langchain/chains";
import { InteractableElement, extractHtml } from "./html-processor.js";
import { htmlToMarkdown } from "./to-markdown.js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore, } from "langchain/vectorstores/memory";
import { COMBINE_PROMPT } from "./prompt/combiner-prompt.js";
import exitHook from 'async-exit-hook';
import { IS_RELEVANT_PROMPT } from "./prompt/relevance-prompt.js";
import { encode } from "gpt-3-encoder"
import { chromium, firefox, Browser, Page, webkit, BrowserContext } from 'playwright';
import { VectorStore } from "@langchain/core/vectorstores";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { Embeddings } from "@langchain/core/embeddings";

export type PlaywrightDriverOptions = {
    browserName?: 'chrome' | 'webkit' | 'firefox';
    disableHeadless?: boolean;

}

export type WebBrowserOptions = {
    browserConfig: PlaywrightDriverOptions
    maximumChunkSize?: number
    doRelevanceCheck?: boolean
    numberOfRelevantDocuments?: number | 'all'
}

const EMPTY_DOCUMENT_TAG = "(Empty the following piece is the beginning of the website)";

export class WebDriverManager {

    private browser?: Browser;
    maximumChunkSize: number
    numberOfRelevantDocuments: number | 'all'
    relevanceCheck: boolean = false;
    vectorStore?: VectorStore;
    documents: VectorDocument[] = [];
    currentPage?: Document;
    interactableElements: Map<string, InteractableElement> = new Map();
    currentPageView?: string;
    page?: { page: Page, browser: Browser, browserContext: BrowserContext };

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
        await this.page?.browser.close();
        this.page = undefined;
    }

    async isActive() {
        return this.page !== undefined;
    }

    async getBrowser() {

        if (this.page) {
            return this.page.page;
        } else {
            const driverConfiguration = await configureBrowser(this.config.browserConfig);
            this.page = driverConfiguration;
            return driverConfiguration.page;
        }
    }


    async getScreenshot(): Promise<string> {
        let driver = await this.getBrowser();
        const base64Image = await driver.screenshot({
            timeout: 30000
        });
        return base64Image.toString("base64");
    }

    async executeScript<T>(funk: any, arg?: any): Promise<T> {
        let driver = await this.getBrowser();
        return driver.evaluate(funk, arg);
    }

    async getTitle(): Promise<string> {
        let driver = await this.getBrowser();
        
        const title = await driver.title();
        return title;
    }

    async navigateToUrl(url: string) {
        let driver = await this.getBrowser();
        await driver!.goto(url);
    }

    async getScreenDimensions() {
        let driver = await this.getBrowser();
        const height: number = await driver?.evaluate(() => window.innerHeight)!;
        const width: number = await driver?.evaluate(() => window.innerWidth)!;
        return {
            height,
            width
        }
    }

    async getTotalPageDimensions() {
        let driver = await this.getBrowser();
        const height: number = await driver?.evaluate(() => ((document as any).height !== undefined) ? (document as any).height : document.body.offsetHeight)!;
        const width: number = await driver?.evaluate(() => ((document as any).width !== undefined) ? (document as any).width : document.body.offsetWidth)!;
        return {
            height,
            width
        }
    }

    async calculateCurrentScrollBlock() {
        let driver = await this.getBrowser();
        const viewDimensions = await this.getScreenDimensions();
        const totalDimensions = await this.getTotalPageDimensions();

        const scrollPosition = await driver?.evaluate(() => window.scrollY)! as number;
        const windowSize = viewDimensions.height;
        const bodyHeight = totalDimensions.height;
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
        let driver = await this.getBrowser();
        let webPage = await extractHtml(await driver!.content(), driver);
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

        this.currentPageView = summarizedPageView;
        return summarizedPageView;
    }


    private async isPageRelevant(page: string, question: string, runManager?: CallbackManagerForToolRun) {
        const llmChain = new LLMChain({ prompt: IS_RELEVANT_PROMPT, llm: this.model, verbose: false });
        let driver = await this.getBrowser();
        const title = await driver.title();
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
        let driver = await this.getBrowser();
        const title = await driver.title();
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
const configureBrowser = async (options: PlaywrightDriverOptions) => {
    switch (options.browserName) {
        case 'chrome': {

            const browser = (await chromium.launch({ headless: !(options.disableHeadless), }));
            const browserContext = await browser.newContext({ screen: { height: 1200, width: 1200 }, viewport: { height: 1200, width: 1200 } });
            const page = await browserContext.newPage();
            return { page, browser, browserContext }
        }
        case 'webkit': {
            const browser = await webkit.launch({ headless: !(options.disableHeadless) });
            const browserContext = await browser.newContext({ screen: { height: 1200, width: 1200 }, viewport: { height: 1200, width: 1200 } });
            const page = await browserContext.newPage();
            return { page, browser, browserContext }
        }
        case 'firefox': {
            const browser = await firefox.launch({ headless: !(options.disableHeadless), });
            const browserContext = await browser.newContext({ screen: { height: 1200, width: 1200 }, viewport: { height: 1200, width: 1200 } });
            
            const page = await browserContext.newPage();
            return { page, browser, browserContext }
        }
        default: {
            throw new Error(`Browser ${options.browserName} not supported`);
        }
    }
}



