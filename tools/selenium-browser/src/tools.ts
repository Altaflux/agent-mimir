
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { StructuredTool, Tool } from "langchain/tools";
import { By } from 'selenium-webdriver';
import { WebDriverManager } from "./driver-manager.js";
import { ZodObject, ZodEffects } from "zod";
import { z } from "zod";
export { WebDriverManager, SeleniumDriverOptions } from "./driver-manager.js";

function parseToolInput(response: string) {
    const result = response.split(",").map((input: string) => {
        let t = input.trim();
        t = t.startsWith('"') ? t.slice(1) : t;
        t = t.endsWith('"') ? t.slice(0, -1) : t;
        t = t.endsWith("/") ? t.slice(0, -1) : t;
        return t.trim();
    });
    return [...result.slice(0, 2), result.slice(2).join('')];
}

export class WebBrowserTool extends StructuredTool {
    schema = z.object({
        url: z.string().describe("The url to navigate to."),
        keywords: z.array(z.string()).describe("keywords representing what you want to find."),
        searchDescription: z.string().describe("a long and detailed description of what do expect to find in the page."),
    })

    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun): Promise<string> {
        const {url, keywords, searchDescription} = inputs;
        let formattedBaseUrl = url;
        if (!formattedBaseUrl.startsWith("http://") && !formattedBaseUrl.startsWith("https://")) {
            formattedBaseUrl = "https://" + formattedBaseUrl;
        }
        await this.toolManager.navigateToUrl(formattedBaseUrl);
        const driver = await this.toolManager.getDriver();
        const result = await this.toolManager.obtainSummaryOfPage(keywords.join(","), searchDescription, runManager);
        return `You are currently in page: ${await driver.getTitle()}\n ${result}`;
    }
    name = "navigate-to-website";
    description = `useful for when you need to find something on or summarize a webpage.`;

}

export class ClickWebSiteLinkOrButton extends StructuredTool {

    schema = z.object({
        id: z.string().describe("A valid id of a link or button"),
        keywords: z.array(z.string()).describe("keywords representing what you want to find."),
        searchDescription: z.string().describe("a long and detailed description of what do expect to find in the page."),
    })


    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun): Promise<string> {
        if (!this.toolManager.currentPage) {
            return "You are not in any website at the moment, navigate into one using: navigate-to-website";
        }
        const {id, keywords, searchDescription} = inputs;

        const elementId = id.replace(/\D/g, '');
        const driver = await this.toolManager.getDriver();
        const clickableElement = this.toolManager.interactableElements.get(elementId);

        if (!clickableElement) {
            return "Button or link not found for id: " + id;
        }
        const byExpression = By.xpath(clickableElement.xpath);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            try {
                await driver.actions().move({ origin: elementFound }).click().perform();
                await new Promise(res => setTimeout(res, 500));
                await this.toolManager.refreshPageState();
                const result = await this.toolManager.obtainSummaryOfPage(keywords.join(","), searchDescription, runManager);
                return `You are currently in page: ${await driver.getTitle()}\n ${result}`;
            } catch (e) {
                return "Click failed for id: " + id;
            }

        } else {
            return "Button or link not found for id: " + id;
        }
    }
    name = "click-website-link-or-button";
    description = `useful for when you need to click on an element from the current page you are on.`;

}

export class PassValueToInput extends StructuredTool {

    schema = z.object({
        id: z.string().describe("A valid id of a input"),
        value: (z.string()).describe("the value to set to the input."),
    })

    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: z.input<this["schema"]>): Promise<string> {
        if (!this.toolManager.currentPage) {
            return "You are not in any website at the moment, navigate into one using: navigate-to-website";
        }


        const elementId = inputs.id.replace(/\D/g, '');
        const driver = await this.toolManager.getDriver();
        const clickableElement = this.toolManager.interactableElements.get(elementId);
        if (!clickableElement) {
            return "Button or link not found for id: " + inputs.id;
        }
        const byExpression = By.xpath(clickableElement.xpath);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            await driver.actions().move({ origin: elementFound }).clear();
            await driver.actions().move({ origin: elementFound }).sendKeys(inputs.value).perform();
            return `Input's value has been updated successfully.`;
        } else {
            return "Input not found for id: " + inputs.value;
        }
    }
    name = "set-value-in-website-input-or-textarea";
    description = `useful for when you need to set a value to an input type element from the current page you are on.`;

}


export class AskSiteQuestion extends StructuredTool {

    schema = z.object({
        keywords: z.array(z.string()).describe("keywords representing what you want to find."),
        searchDescription: z.string().describe("a long and detailed description of what do expect to find in the page."),
    })

    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun): Promise<string> {
        if (!this.toolManager.currentPage) {
            return "You are not in any website at the moment, navigate into one using: navigate-to-website";
        }
        const [keywords, task] = parseToolInput(inputs);
        const result = await this.toolManager.obtainSummaryOfPage(keywords, task, runManager);
        return result;
    }
    name = "look-information-on-current-website";
    description = `useful for when you need to find more information in the site you are currently on.`;

}
