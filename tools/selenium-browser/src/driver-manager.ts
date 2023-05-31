
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
export type SeleniumDriverOptions = {
    browserName?: 'chrome' | 'firefox' | 'edge';
    disableHeadless?: boolean;
    driver?: ThenableWebDriver
}

export type WebBrowserOptions = {
    browserConfig: SeleniumDriverOptions
    maximumChunkSize?: number
    numberOfRelevantDocuments?: number
}


export class WebDriverManager {

    driver?: ThenableWebDriver;
    maximumChunkSize: number
    numberOfRelevantDocuments: number

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
        let driver = await this.getDriver();
        let webPage = await extractHtml(await driver!.getPageSource(), driver);
        this.currentPage = webPage.html;
        this.interactableElements = webPage.interactableElements;

        const siteMarkdown = htmlToMarkdown(this.currentPage!);

        const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: this.maximumChunkSize, chunkOverlap: 200 });
        const texts = await textSplitter.splitText(siteMarkdown);
        const documents = texts.map((pageContent, index) => new VectorDocument({ pageContent: pageContent, metadata: { pageNumber: index } }));

        const vectorStore = await MemoryVectorStore.fromDocuments(this.documents, this.embeddings);

        this.documents = documents;
        this.vectorStore = vectorStore;

    }

    async getDocumentsBySimilarity(question: string, maxEntries: number) {
        return await this.vectorStore!.similaritySearch(question, maxEntries);
    }

    async obtainSummaryOfPage(question: string, runManager?: CallbackManagerForToolRun) {
        let results;
        if (!question || question === "") {
            results = this.documents.slice(0, this.numberOfRelevantDocuments);
        } else {
            const similaritySearchResults = await this.vectorStore!.similaritySearch(question, this.numberOfRelevantDocuments)
            results = similaritySearchResults.length > 0 ? similaritySearchResults : this.documents.slice(0, this.numberOfRelevantDocuments);;
        }

        return await this.combineDocuments(results
            .sort((doc1, doc2) => doc1.metadata.pageNumber - doc2.metadata.pageNumber)
            , question, runManager);
    }

    private async combineDocuments(documents: VectorDocument[], question: string, runManager?: CallbackManagerForToolRun) {
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
                }, runManager?.getChild())).text;

                return new VectorDocument({
                    pageContent: result,
                    metadata: [],
                });
            })).pageContent;
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
