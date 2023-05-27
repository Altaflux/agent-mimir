
import { Document as LangVector} from 'langchain/document'
import { VectorStore } from "langchain/vectorstores";
import { Embeddings } from "langchain/embeddings";
import {  Builder, By, ThenableWebDriver } from 'selenium-webdriver';
import { BaseLanguageModel } from "langchain/base_language";
import { LLMChain } from "langchain/chains";
import { RELEVANCE_PROMPT } from "./summary/relevance-prompt.js";
import { extractHtml } from "./html-cleaner.js";
import { htmlToMarkdown } from "./to-markdown.js";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore, } from "langchain/vectorstores/memory";
import { COMBINE_PROMPT } from "./summary/combiner-prompt.js";
import {
    Options,
    update,
} from 'webdriver-manager';

export type SeleniumDriverOptions = {
    browserName?: 'chrome' | 'firefox' | 'safari' | 'edge';
    driver?: ThenableWebDriver
}

export type SUMMARY_MODE = 'fast' | 'slow' | number;
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export class WebDriverManager {

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
        let cleanHtml = await extractHtml(await driver!.getPageSource(), driver);
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
                    pageContent: await this.doSummary(selectedDocuments, question),
                    metadata: [],
                })
            }
        }));

        return await this.doSummary(selectedDocs.map((doc) => doc.document), question);
    }



    private async doSummary(documents: LangVector[], question: string) {
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
