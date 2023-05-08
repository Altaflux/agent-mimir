import * as cheerio from "cheerio";
import { BaseLanguageModel } from "langchain/base_language";
import { CallbackManager, CallbackManagerForToolRun } from "langchain/callbacks";
import { Embeddings } from "langchain/embeddings";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Tool, ToolParams } from "langchain/tools";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from 'langchain/document'
import { StringPromptValue } from "langchain/prompts";

import { Builder } from 'selenium-webdriver';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome.js';
import { Options as FireFoxOptions } from 'selenium-webdriver/firefox.js';

import {
    Options,
    update,
} from 'webdriver-manager';

export type SeleniumDriverOptions = {
    browserName?: 'chrome' | 'firefox' | 'safari' | 'edge';
}
export const getText = (
    html: string,
    baseUrl: string,
    summary: boolean
): string => {
    // scriptingEnabled so noscript elements are parsed
    const $ = cheerio.load(html, { scriptingEnabled: true });

    let text = "";

    // lets only get the body if its a summary, dont need to summarize header or footer etc
    const rootElement = summary ? "body " : "*";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $(`${rootElement}:not(style):not(script):not(svg)`).each((_i, elem: any) => {
        // we dont want duplicated content as we drill down so remove children
        let content = $(elem).clone().children().remove().end().text().trim();
        const $el = $(elem);

        // if its an ahref, print the content and url
        let href = $el.attr("href");
        if ($el.prop("tagName")?.toLowerCase() === "a" && href) {
            if (!href.startsWith("http")) {
                try {
                    href = new URL(href, baseUrl).toString();
                } catch {
                    // if this fails thats fine, just no url for this
                    href = "";
                }
            }

            const imgAlt = $el.find("img[alt]").attr("alt")?.trim();
            if (imgAlt) {
                content += ` ${imgAlt}`;
            }

            text += ` [${content}](${href})`;
        }
        // otherwise just print the content
        else if (content !== "") {
            text += ` ${content}`;
        }
    });

    return text.trim().replace(/\n+/g, " ");
};

const configureDriver = async (options: SeleniumDriverOptions) => {
    let builder = new Builder();
    switch (options.browserName) {
        case 'chrome': {
            builder = builder.forBrowser("chrome")
                .setChromeOptions(new ChromeOptions().addArguments('--headless=new'))
        
            break
        }
        case 'firefox': {
            builder = builder.forBrowser("firefox")
                .setFirefoxOptions(new FireFoxOptions().headless())
    
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
const getHtml = async (
    baseUrl: string,
    options: SeleniumDriverOptions
) => {

    const driverConfiguration = await configureDriver(options);
    let driver = undefined;
    try {
        await downloadDrivers(options.browserName);
        driver = driverConfiguration.build();
        await driver.manage().setTimeouts({
            pageLoad: 10000,
        });

        await driver.get(baseUrl);
        await driver.wait(async (wd)=>{
           let state = await wd.executeScript("return document.readyState");
           return state === 'complete';
        });

        const html = await driver.getPageSource()

        return html;
    } finally {
        if (driver) {
            try {
                await driver.close()
                await driver.quit();
            } catch (e) {
                //
            }
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

export class SeleniumWebBrowser extends Tool {
    private model: BaseLanguageModel;
    private embeddings: Embeddings;
    private seleniumDriverOptions: SeleniumDriverOptions

    constructor({
        model,
        embeddings,
        verbose,
        callbacks,
        callbackManager,
        seleniumDriverOptions

    }: WebBrowserArgs) {
        super(verbose, callbacks ?? callbackManager);
        this.model = model;
        this.embeddings = embeddings;
        this.seleniumDriverOptions = seleniumDriverOptions ?? { browserName: 'chrome' };

    }

    /** @ignore */
    async _call(inputs: string, runManager?: CallbackManagerForToolRun) {
        const [baseUrl, task] = inputs.split(",").map((input) => {
            let t = input.trim();
            t = t.startsWith('"') ? t.slice(1) : t;
            t = t.endsWith('"') ? t.slice(0, -1) : t;
            // it likes to put / at the end of urls, wont matter for task
            t = t.endsWith("/") ? t.slice(0, -1) : t;
            return t.trim();
        });
        const doSummary = !task;

        let text;
        try {
            const html = await getHtml(baseUrl, this.seleniumDriverOptions);
            text = getText(html, baseUrl, doSummary);
        } catch (e) {
            if (e) {
                return e.toString();
            }
            return "There was a problem connecting to the site";
        }

        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 2000,
            chunkOverlap: 200,
        });
        const texts = await textSplitter.splitText(text);

        let context;
        // if we want a summary grab first 4
        if (doSummary) {
            context = texts.slice(0, 4).join("\n");
        }
        // search term well embed and grab top 4
        else {
            const docs = texts.map(
                (pageContent) =>
                    new Document({
                        pageContent,
                        metadata: [],
                    })
            );

            const vectorStore = await MemoryVectorStore.fromDocuments(
                docs,
                this.embeddings
            );
            const results = await vectorStore.similaritySearch(task, 4);
            context = results.map((res) => res.pageContent).join("\n");
        }

        const input = `Text:${context}\n\nI need ${doSummary ? "a summary" : task
            } from the above text, also provide up to 5 markdown links from within that would be of interest (always including URL and text). Links should be provided, if present, in markdown syntax as a list under the heading "Relevant Links:".`;

        const res = await this.model.generatePrompt(
            [new StringPromptValue(input)],
            undefined,
            runManager?.getChild()
        );

        return res.generations[0][0].text;
    }

    name = "web-browser";

    description = `useful for when you need to find something on or summarize a webpage. input should be a comma seperated list of "ONE valid http URL including protocol","what you want to find on the page in plain english.".`;
}
