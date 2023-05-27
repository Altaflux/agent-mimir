import { JSDOM } from 'jsdom';
import { getXPath } from './xpath.js';
import TurndownService from 'turndown';
import { By, WebDriver } from 'selenium-webdriver';

const selectableElements = ['input', 'select', 'textarea'];
const interactableElements = [...selectableElements, 'a', 'button', 'input', 'link', 'select', 'textarea'];
const persistableElements = [...interactableElements, (element: Element) => {
    return (element.childNodes.length === element.ELEMENT_NODE &&
        element.childNodes[0].nodeType === element.TEXT_NODE &&  //3 is for Text Node (Node.TEXT_NODE)
        element.childNodes[0].textContent?.trim() !== '')
}];

type RelevantElement = "input" | "clickable" | "text";

// Function to check if an element is a button, link or has readable text
function isRelevantElement(element: Element) {
    let isPersistable = persistableElements.find((e) => {
        if (typeof e === 'string') {
            return e === element.tagName.toLowerCase();
        } else if (typeof e === 'function') {
            return e(element);
        }
    });
    return isPersistable !== undefined;
}

function addRandomIdToElements(doc: Element) {
    const allElements = doc.querySelectorAll('*');
    for (const element of Array.from(allElements)) {
        if (isRelevantElement(element)) {
            element.setAttribute('x-interactableId', (Math.floor(Math.random() * 9000) + 1000).toString());
        }
    }
    return doc;
}


function findAllRelevantElements(doc: Element) {
    const allElements = doc.querySelectorAll('*');
    return Array.from(allElements)
        .filter((e) => isRelevantElement(e))
        .map((element) => {
            const tag = element.tagName.toLowerCase();
            const type = (selectableElements.includes(tag) ? 'input' : interactableElements.includes(tag) ? 'clickable' : 'text') as RelevantElement;
            return {
                id: element.getAttribute('x-interactableId')!,
                xpath: getXPath(element),
                element: element,
                type: type,
            }
        });

}



function isEmptyOrSpaces(str: string | null) {
    return str === null || str.match(/^ *$/) !== null;
}

function getInputorLinkInfo(document: ParentNode, element: Element) {

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel !== '') {
        return ariaLabel!
    }
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
        const labelledByElement = document.querySelector(`#${ariaLabelledBy}`)  //  $(`#${ariaLabelledBy}`);
        if (labelledByElement) {
            if (!labelledByElement.textContent) {
                console.log(`No text content for aria-labelledby ${ariaLabelledBy}`);
            }
            return labelledByElement.textContent?.trim() ?? null;
        }
    }

    if (!isEmptyOrSpaces(element.textContent?.trim() ?? null)) {
        return element.textContent?.trim() ?? null;
    }
    return null;
}

type RelevantThingsInfo = {
    id: string;
    xpath: string;
};
async function removeInvisibleElements2(element: Element, driver: WebDriver, relevants: RelevantThingsInfo[]) {

    let counter = 0;
    let discardCounter = 0;
    for (const relevant of relevants) {
        const byExpression = By.xpath(relevant.xpath);
        const foundElement = await driver!.findElement(byExpression);

        if (foundElement) {
            try {
                let isElementInteractable: boolean = await driver.executeScript(`
                window.document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
                function isElementUnderOverlay(element) {
                    const rect = element.getBoundingClientRect();
                    const middleX = rect.left + rect.width / 2;
                    const middleY = rect.top + rect.height / 2;
                    const topElement = document.elementFromPoint(middleX, middleY);
                    return topElement !== element && !element.contains(topElement);
                }
                function isElementClickable(element) {
                    const styles = getComputedStyle(element);
                    return styles.pointerEvents !== 'none';
                }
                function isElementInteractable(element) {
                    return !isElementUnderOverlay(element) && isElementClickable(element);
                }
                
                function getElementByXpath(path) {
                  return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                }
                
                let xpath = arguments[0];
                let el = getElementByXpath(xpath);
                if (el) {
                    el.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
                    return isElementInteractable(el);
                }
                return true;`, relevant.xpath);

                if (!isElementInteractable) {
                    let elementToRemove = element.querySelector(`[x-interactableId="${relevant.id}"]`);
                    if (elementToRemove) {
                        discardCounter++;
                        elementToRemove.remove();
                    }
                }
            } catch (e) {

            }

        }

    }
    console.log(`Scrolled ${counter} times`);
    console.log(`Discarded ${discardCounter} elements`);
}



export async function clickables(html: string, driver: WebDriver) {
    const ogDoc = new JSDOM(html).window.document;
    let cleanHtml = addRandomIdToElements(ogDoc.body);
    let allRelevantElements = findAllRelevantElements(cleanHtml);

    await removeInvisibleElements2(cleanHtml, driver, allRelevantElements);

    let clickables = allRelevantElements
        .filter((relevant) => interactableElements.includes(relevant.element.tagName.toLowerCase()))
        .map((entries) => {
            return {
                id: entries.element.getAttribute('x-interactableId')!,
                xpath: entries.xpath,
                type: entries.type,
            }
        });

    const turndownService = new TurndownService()
        .addRule('formatLink', {
            filter: ['a'],
            replacement: function (content, node, options) {
                let element = node as HTMLElement;
                const description = getInputorLinkInfo(ogDoc, element);
                if (description) {
                    return `<a ${buildAttribute("id", element.getAttribute('x-interactableId'))}>${description}</a>`
                }
                return "";
            }
        })
        .addRule('formatButton', {
            filter: ['button'],
            replacement: function (content, node, options) {
                let element = node as HTMLElement;
                const description = getInputorLinkInfo(ogDoc, element);
                if (description) {
                    return `<button ${buildAttribute("type", element.getAttribute('type'), "button")} ${buildAttribute("id", element.getAttribute('x-interactableId'))} >${description}</button>`
                }
                return "";
            }
        })
        .addRule('removeScript', {
            filter: ['script'],
            replacement: function () {
                return "";
            }
        })
        .addRule('formatInput', {
            filter: ['input'],
            replacement: function (_, node) {
                let element = node as HTMLElement;
                const description = getInputorLinkInfo(ogDoc, element);
                if (description) {
                    return `<input ${buildAttribute("type", element.getAttribute('type'), "text")} ${buildAttribute("name", element.getAttribute('name'))}  ${buildAttribute("id", element.getAttribute('x-interactableId'))} >${description}</input>`
                }
                return "";
            }
        });

    const markdown = turndownService.turndown(cleanHtml.outerHTML);
    console.log("");
    return {
        html: markdown,
        clickables: clickables,
        inputs: []
    }
}

function buildAttribute(attributeName: string, attributeValue: string | null, defaultValue?: string) {
    if (attributeValue) {
        return `${attributeName}="${attributeValue}"`;
    } else if (defaultValue) {
        return `${attributeName}="${defaultValue}"`;
    }
    return "";
}