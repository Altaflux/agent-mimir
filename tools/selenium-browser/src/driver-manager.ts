
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { Document as VectorDocument } from 'langchain/document'
import { VectorStore } from "langchain/vectorstores";
import { Embeddings } from "langchain/embeddings";
import { Builder, ThenableWebDriver } from 'selenium-webdriver';
import { BaseLanguageModel } from "langchain/base_language";
import { LLMChain } from "langchain/chains";
import { InteractableElement, extractHtml } from "./html-processor.js";
import { htmlToMarkdown } from "./to-markdown.js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore, } from "langchain/vectorstores/memory";
import { COMBINE_PROMPT } from "./prompt/combiner-prompt.js";
import { Options, update, } from 'webdriver-manager';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome';
import { Options as FireFoxOptions } from 'selenium-webdriver/firefox';
import { Options as EdgeOptions } from 'selenium-webdriver/edge.js';
import exitHook from 'async-exit-hook';
import { IS_RELEVANT_PROMPT } from "./prompt/relevance-prompt.js";

export type SeleniumDriverOptions = {
    browserName?: 'chrome' | 'firefox' | 'edge';
    disableHeadless?: boolean;
    driver?: ThenableWebDriver
}

export type WebBrowserOptions = {
    browserConfig: SeleniumDriverOptions
    maximumChunkSize?: number
    numberOfRelevantDocuments?: number | 'all'
}

export class WebDriverManager {

    driver?: ThenableWebDriver;
    maximumChunkSize: number
    numberOfRelevantDocuments: number | 'all'

    vectorStore?: VectorStore;
    documents: VectorDocument[] = [];
    currentPage?: Document;
    interactableElements: Map<string, InteractableElement> = new Map();

    constructor(private config: WebBrowserOptions, private model: BaseLanguageModel, private embeddings: Embeddings) {
        this.maximumChunkSize = config.maximumChunkSize || 3000;
        this.numberOfRelevantDocuments = config.numberOfRelevantDocuments || 2;

        exitHook(async (callback) => {
            await this.driver?.quit();
            callback();
        });
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

    async navigateToUrl(url: string) {
        let driver = await this.getDriver();
        await driver!.get(url);
        await this.refreshPageState()
    }

    async refreshPageState() {

        await new Promise(resolve => setTimeout(resolve, 2000));
        let driver = await this.getDriver();
        let webPage = await extractHtml(await driver!.getPageSource(), driver);
        this.currentPage = webPage.html;
        this.interactableElements = webPage.interactableElements;

        const siteMarkdown = htmlToMarkdown(this.currentPage!);

        const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: this.maximumChunkSize, chunkOverlap: 200 });
        const texts = await textSplitter.splitText(siteMarkdown);
        const documents = texts.map((pageContent, index) => new VectorDocument({ pageContent: pageContent, metadata: { pageNumber: index } }));

        this.documents = documents;
        this.vectorStore =  await MemoryVectorStore.fromDocuments(this.documents, this.embeddings);;

    }

    async getDocumentsBySimilarity(question: string, maxEntries: number) {
        return await this.vectorStore!.similaritySearch(question, maxEntries);
    }

    async obtainSummaryOfPage(keywords: string, question: string, runManager?: CallbackManagerForToolRun) {
        let results;
        if (this.numberOfRelevantDocuments === 'all') {
            results = this.documents;
        }
        else if (!keywords || keywords === "") {
            results = this.documents.slice(0, this.numberOfRelevantDocuments);
        } else {
            const similaritySearchResults = await this.getDocumentsBySimilarity(keywords, this.numberOfRelevantDocuments)
            results = similaritySearchResults.length > 0 ? similaritySearchResults : this.documents.slice(0, this.numberOfRelevantDocuments);
        }

        if (results.length === 1) {
            return results[0].pageContent;
        }

        const summarizedPageView = await this.combineDocuments(results
            .sort((doc1, doc2) => doc1.metadata.pageNumber - doc2.metadata.pageNumber)
            , question, runManager);

        if (!await this.isPageRelevant(summarizedPageView, question, runManager)) {
            return await this.combineDocuments(results
                .sort((doc1, doc2) => doc1.metadata.pageNumber - doc2.metadata.pageNumber)
                , "Important information on the site.", runManager);
        }
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
                const llmChain = new LLMChain({ prompt: COMBINE_PROMPT, llm: this.model, verbose: false });
                const previousDocument = await prev;
                const currentDocument = await current;

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
            }, Promise.resolve(new VectorDocument({ pageContent: "(Empty the following piece is the beginning of the website)", metadata: { pageNumber: 0 } })))).pageContent;
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
