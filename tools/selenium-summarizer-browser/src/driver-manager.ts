
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { Document as VectorDocument } from 'langchain/document'
import { VectorStore } from "langchain/vectorstores";
import { Embeddings } from "langchain/embeddings";
import { Builder, ThenableWebDriver } from 'selenium-webdriver';
import { BaseLanguageModel } from "langchain/base_language";
import { LLMChain } from "langchain/chains";
import { InteractableElement, extractHtml } from "./html-cleaner.js";
import { htmlToMarkdown } from "./to-markdown.js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore, } from "langchain/vectorstores/memory";
import { COMBINE_PROMPT } from "./prompt/combiner-prompt.js";
import { Options, update, } from 'webdriver-manager';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome';
import exitHook from 'async-exit-hook';
export type SeleniumDriverOptions = {
    browserName?: 'chrome' | 'firefox' | 'safari' | 'edge';
    driver?: ThenableWebDriver
}

export type WebBrowserOptions = {
    browserConfig: SeleniumDriverOptions
    maximumChunkSize?: number
    windowSize?: number
    numeberOfRelevantDocuments?: number
}


export class WebDriverManager {

    driver?: ThenableWebDriver;
    maximumChunkSize: number
    windowSize: number
    numeberOfRelevantDocuments: number

    vectorStore?: VectorStore;
    documents: VectorDocument[] = [];
    currentPage?: Document;
    interactableElements: Map<string, InteractableElement> = new Map();

    constructor(private config: WebBrowserOptions, private model: BaseLanguageModel, private embeddings: Embeddings) {
        this.maximumChunkSize = config.maximumChunkSize || 3000;
        this.windowSize = config.windowSize || 1;
        this.numeberOfRelevantDocuments = config.numeberOfRelevantDocuments || 1;

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
        const documents = texts.map((pageContent) => new VectorDocument({ pageContent: pageContent }));

        let vectorStore = await MemoryVectorStore.fromDocuments(this.documents, this.embeddings);

        this.documents = documents;
        this.vectorStore = vectorStore;

    }

    async getDocumentsBySimilarity(question: string, maxEntries: number = 5) {
        return await this.vectorStore!.similaritySearch(question, maxEntries);
    }

    async obtainSummaryOfPage(question: string, runManager?: CallbackManagerForToolRun) {
        let results;
        if (!question || question === "") {
            results = [this.documents[1] ?? this.documents[0]];
        } else {
            results = await this.vectorStore!.similaritySearch(question, this.numeberOfRelevantDocuments)
        }

        let selectedDocs = await Promise.all(results.map(async (document) => {
            const location = this.documents.findIndex((doc) => doc.pageContent === document.pageContent);
            const startingLocation = location;
            const windowSize = this.windowSize;
            const selectedDocuments = this.documents.slice(startingLocation, startingLocation + windowSize);
            return {
                document: new VectorDocument({
                    pageContent: await this.doSummary(selectedDocuments, question),
                    metadata: [],
                })
            }
        }));

        return await this.doSummary(selectedDocs.map((doc) => doc.document), question, runManager);
    }



    private async doSummary(documents: VectorDocument[], question: string,  runManager?: CallbackManagerForToolRun) {
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
            builder = builder.forBrowser("chrome")
            //   .setChromeOptions(new ChromeOptions().addArguments('--headless=new'))
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