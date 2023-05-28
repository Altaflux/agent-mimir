
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { Tool } from "langchain/tools";
import { By } from 'selenium-webdriver';
import { WebDriverManager } from "./driver-manager.js";

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));


export { WebDriverManager, SeleniumDriverOptions } from "./driver-manager.js";

function responseParser(response: string) {
    return response.split(",").map((input: string) => {
        let t = input.trim();
        t = t.startsWith('"') ? t.slice(1) : t;
        t = t.endsWith('"') ? t.slice(0, -1) : t;
        t = t.endsWith("/") ? t.slice(0, -1) : t;
        return t.trim();
    });
}

export class WebBrowserTool extends Tool {
    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const [baseUrl, task] = responseParser(inputs);
        let formattedBaseUrl = baseUrl;
        if (!formattedBaseUrl.startsWith("http://") && !formattedBaseUrl.startsWith("https://")) {
            formattedBaseUrl = "https://" + formattedBaseUrl;
        }
        await this.toolManager.navigateToUrl(formattedBaseUrl);
        const driver = await this.toolManager.getDriver();
        const result = await this.toolManager.obtainSummaryOfPage(task, 'slow');
        return `You are currently in page: ${await driver.getTitle()}\n ${result}`;
    }
    name = "navigate-to-website";
    description = `useful for when you need to find something on or summarize a webpage. input should be a comma seperated list of "ONE valid http URL including protocol","what you want to find on the page in plain english in the form of a question.".`;

}

export class ClickWebSiteLinkOrButton extends Tool {
    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        if (!this.toolManager.currentPage) {
            return "You are not in any website at the moment, navigate into one using: navigate-to-website";
        }
        const [id, focus] = responseParser(inputs);

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
                await delay(2000);
                await this.toolManager.refreshPageState();
                const result = await this.toolManager.obtainSummaryOfPage(focus, 'fast');
                return `You are currently in page: ${await driver.getTitle()}\n ${result}`;
            } catch (e) {
                return "Click failed for id: " + id;
            }

        } else {
            return "Button or link not found for id: " + id;
        }
    }
    name = "click-website-link-or-button";
    description = `useful for when you need to click on an element from the current page you are on. input should be a comma seperated list of "ONE valid id of a link or button","what information are you looking for.".`;

}

export class PassValueToInput extends Tool {
    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        if (!this.toolManager.currentPage) {
            return "You are not in any website at the moment, navigate into one using: click-website-link-or-button";
        }
        const [id, value] = responseParser(inputs);

        const elementId = id.replace(/\D/g, '');
        const driver = await this.toolManager.getDriver();
        const clickableElement = this.toolManager.interactableElements.get(elementId);
        if (!clickableElement) {
            return "Button or link not found for id: " + id;
        }
        const byExpression = By.xpath(clickableElement.xpath);
        const elementFound = await driver!.findElement(byExpression);
        if (elementFound) {
            await driver.actions().move({ origin: elementFound }).clear()
            await driver.actions().move({ origin: elementFound }).sendKeys(value).perform();
            return `Input's value has been updated successfully.`;
        } else {
            return "Input not found for id: " + id;
        }
    }
    name = "set-value-in-page-input";
    description = `useful for when you need to set a value to an input type element from the current page you are on. input should be a comma seperated list of "ONE valid id of a input","the value to set to the input.".`;

}


export class AskSiteQuestion extends Tool {
    constructor(private toolManager: WebDriverManager) {
        super();
    }
    protected async _call(inputs: string, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const result = await this.toolManager.obtainSummaryOfPage(inputs, 'fast');
        return result;
    }
    name = "look-information-on-current-page";
    description = `useful for when you need to find more information in the site you are currently on. input should be what information are you looking for.`;

}
