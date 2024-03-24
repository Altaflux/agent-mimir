
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { By } from 'selenium-webdriver';
import { WebDriverManager } from "./driver-manager.js";
import { z } from "zod";
import { AgentTool } from "agent-mimir/tools";
import { ToolResponse } from "agent-mimir/schema";
export { WebDriverManager, SeleniumDriverOptions } from "./driver-manager.js";

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
        const driver = await this.toolManager.getDriver();
              
        return [
            {
                type: "text",
                text: `You are currently in page: "${await driver.getTitle()}".\n`,
            }
        ]
    }
    name = "navigate-to-website";
    description = `useful for when you need to find something on or summarize a webpage.`;

}

export class ClickWebSiteLinkOrButton extends AgentTool {

    schema = z.object({
        id: z.string().describe("A valid id of a link or button"),
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
        const driver = await this.toolManager.getDriver();
        const clickableElement = this.toolManager.interactableElements.get(elementId);

        if (!clickableElement) {
            return [
                {
                    type: "text",
                    text: `Button or link not found for id: ${id}.\n The current page is: ${await driver.getTitle()}\n`
                }
            ]
        }
        const byExpression = By.xpath(clickableElement.xpath);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            try {
                await driver!.executeScript(`window.scrollTo({top: arguments[0], behavior: 'instant'});`, clickableElement.location.top);
                await driver.actions().move({ origin: elementFound }).perform();
                await driver!.executeScript(`arguments[0].click()`, elementFound);
                await new Promise(res => setTimeout(res, 500));

                return [
                    {
                        type: "text",
                        text: `You are currently in page: ${await driver.getTitle()}`
                    }
                ]
            } catch (e) {

                return [
                    {
                        type: "text",
                        text: `Click failed for id: ${id}.\n The current page is: ${await driver.getTitle()}\n `
                    }
                ]
            }
        } else {

            return [
                {
                    type: "text",
                    text: `Button or link not found for id: ${id}.\n The current page is: ${await driver.getTitle()}\n `
                }
            ]
        }
    }
    name = "click-website-link-or-button";
    description = `useful for when you need to click on an element from the current page you are on.`;

}



export class ScrollTool extends AgentTool {

    schema = z.object({
        direction: z.enum(["up", "down"]).describe(`The direction to which scroll the website.`),
    })

    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>): Promise<ToolResponse> {
        const height: number = await this.toolManager.driver?.executeScript("window.innerHeight")!;
        const adjustedHeight = height - 100;
        if (inputs.direction === "up") {
            await this.toolManager.driver?.executeScript(`window.scrollBy(0,-${adjustedHeight})`, "")
        } else {
            await this.toolManager.driver?.executeScript(`window.scrollBy(0,${adjustedHeight})`, "")
        }

        return [
            {
                type: "text",
                text: "The browser has been scrolled."
            }
        ]

    }
    name = "scroll-in-browser";
    description = `Use when you need to scroll up or down in the browser to see more information.`;

}




export class PassValueToInput extends AgentTool {

    schema = z.object({
        id: z.string().describe("A valid id of a input"),
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
        const driver = await this.toolManager.getDriver();
        const clickableElement = this.toolManager.interactableElements.get(elementId);
        if (!clickableElement) {

            return [
                {
                    type: "text",
                    text: "Button or link not found for id: " + inputs.id
                }
            ]
        }
        const byExpression = By.xpath(clickableElement.xpath);
        //await driver!.executeScript(`window.scrollTo({top: arguments[0], behavior: 'instant'});`, clickableElement.location.top);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            await driver.actions().move({ origin: elementFound }).clear();
            await driver.actions().move({ origin: elementFound }).sendKeys(inputs.value).perform();

            return [
                {
                    type: "text",
                    text: `Input's value has been updated successfully.`
                }
            ]
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
