
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";

import { WebDriverManager } from "./driver-manager.js";
import { z } from "zod";
import { AgentTool, ToolResponse } from "@mimir/agent-core/tools";
import { Page } from "playwright";
export { WebDriverManager, PlaywrightDriverOptions as SeleniumDriverOptions } from "./driver-manager.js";

export class WebBrowserTool extends AgentTool {
    schema = z.object({
        url: z.string().describe("The url to navigate to."),
        keywords: z.array(z.string()).describe("keywords representing what you want to find."),
        searchDescription: z.string().describe("a long and detailed description of what do expect to find in the page."),
    })

    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        const { url, keywords, searchDescription } = inputs;
        let formattedBaseUrl = url;
        if (!formattedBaseUrl.startsWith("http://") && !formattedBaseUrl.startsWith("https://")) {
            formattedBaseUrl = "https://" + formattedBaseUrl;
        }
        await this.toolManager.navigateToUrl(formattedBaseUrl);
        const driver = await this.toolManager.getBrowser();

        return [
            {
                type: "text",
                text: `You are currently in page: "${await driver.title()}".\n`,
            }
        ]
    }
    name = "navigate-to-website";
    description = `useful for when you need to find something on or summarize a webpage.`;

}

export class ClickWebSiteLinkOrButton extends AgentTool {

    schema = z.object({
        id: z.string().describe("A valid id of a link or button that is currently visible."),
        keywords: z.array(z.string()).describe("keywords representing what you want to find."),
        searchDescription: z.string().describe("a long and detailed description of what do expect to find in the page."),
    })


    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        if (!this.toolManager.currentPage) {
            return [
                {
                    type: "text",
                    text: "You are not in any website at the moment, navigate into one using: navigate-to-website"
                }
            ]
        }
        const { id, keywords, searchDescription } = inputs;

        const elementId = id.replace(/\D/g, '');
        const driver = await this.toolManager.getBrowser();
        const clickableElement = this.toolManager.interactableElements.get(elementId);

        if (!clickableElement) {
            return [
                {
                    type: "text",
                    text: `Button or link not found for id: ${id}.\n The current page is: ${await driver.title()}\n`
                }
            ]
        }

       
        const elementFound = driver.locator(clickableElement.xpath);
        if (await elementFound.isVisible()) {
            try {
                const waitForNewPage = this.toolManager.page!.browserContext.waitForEvent('page');
                await elementFound.click();

                const raceWithIdentifier = await Promise.race([
                    waitForNewPage.then(result => ({ source: 'page', result })),
                    new Promise(resolve => 
                        setTimeout(() => resolve({ source: 'timeout', result: null }), 2000)
                    )
                ]) as {source: string, result: Page | null};
                if (raceWithIdentifier.source === 'page') {
                    this.toolManager.page!.page = raceWithIdentifier.result!;
                }
                return [
                    {
                        type: "text",
                        text: `Click executed.`
                    }
                ]
            } catch (e) {

                return [
                    {
                        type: "text",
                        text: `Click failed for id: ${id}.\n The current page is: ${await driver.title()}\n `
                    }
                ]
            }
        } else {

            return [
                {
                    type: "text",
                    text: `Button or link not found for id: ${id}.\n The current page is: ${await driver.title()}\n `
                }
            ]
        }
    }
    name = "click-website-link-or-button";
    description = `Useful for when you need to click on an element from the current page you are on. You can only click on elements that have an ID and are currently visible on the screen, scroll if needed.`;

}



export class ScrollTool extends AgentTool {

    schema = z.object({
        direction: z.enum(["up", "down"]).describe(`The direction to which scroll the website.`),
    })

    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>): Promise<ToolResponse> {
        try {
            const height: number = await this.toolManager.executeScript(() => window.innerHeight,)!;
            const adjustedHeight = height - 100;
            if (inputs.direction === "up") {

                await this.toolManager.executeScript((adjustedHeight: number) => window.scrollBy(0, -adjustedHeight), adjustedHeight)
            } else {
                await this.toolManager.executeScript((adjustedHeight: number) => window.scrollBy(0, adjustedHeight), adjustedHeight)
            }

            return [
                {
                    type: "text",
                    text: "The browser has been scrolled."
                }
            ]

        } catch (e) {
            console.error(e);
            throw e;
        }

    }
    name = "scroll-in-browser";
    description = `Use when you need to scroll up or down in the browser to see more information.`;

}




export class PassValueToInput extends AgentTool {

    schema = z.object({
        id: z.string().describe("A valid id of a input."),
        value: (z.string()).describe("the value to set to the input."),
    })

    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>): Promise<ToolResponse> {

        if (!this.toolManager.currentPage) {

            return [
                {
                    type: "text",
                    text: "You are not in any website at the moment, navigate into one using: navigate-to-website"
                }
            ]
        }

        const elementId = inputs.id.replace(/\D/g, '');
        const driver = await this.toolManager.getBrowser();
        const clickableElement = this.toolManager.interactableElements.get(elementId);
        if (!clickableElement) {

            return [
                {
                    type: "text",
                    text: "Button or link not found for id: " + inputs.id
                }
            ]
        }
        const elementFound = driver!.locator(clickableElement.xpath);
        if (await elementFound.isVisible()) {

            await elementFound.fill(inputs.value);

            return [
                {
                    type: "text",
                    text: `Input's has been sent, verify that the field was updated correctly..`
                }
            ];

        } else {

            return [
                {
                    type: "text",
                    text: "Input not found for id: " + inputs.value
                }
            ]
        }
    }
    name = "set-value-in-website-input-or-textarea";
    description = `useful for when you need to set a value to an input type element from the current page you are on.`;

}


export class AskSiteQuestion extends AgentTool {

    schema = z.object({
        keywords: z.array(z.string()).describe("keywords representing what you want to find."),
        searchDescription: z.string().describe("a long and detailed description of what do expect to find in the page."),
    })

    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun): Promise<ToolResponse> {
        if (!this.toolManager.currentPage) {

            return [
                {
                    type: "text",
                    text: "You are not in any website at the moment, navigate into one using: navigate-to-website"
                }
            ]
        }
        const { keywords, searchDescription } = inputs;
        const result = await this.toolManager.obtainSummaryOfPage(keywords.join(' '), searchDescription, runManager);

        return [
            {
                type: "text",
                text: result

            }
        ]
    }
    name = "look-information-on-current-website";
    description = `useful for when you need to find more information in the site you are currently on.`;

}
