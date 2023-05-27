import { JSDOM } from 'jsdom';
import { getXPath } from './xpath-finder.js';
import TurndownService from 'turndown';
import { By,  WebDriver } from 'selenium-webdriver';


const interactableElements = ['a', 'button', 'input', 'link', 'select', 'textarea'];
const persistableElements = [...interactableElements, (element: Element) => {
    return (element.childNodes.length === 1 &&
        element.childNodes[0].nodeType === 3 &&  //3 is for Text Node (Node.TEXT_NODE)
        element.childNodes[0].textContent?.trim() !== '')
}];


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

// Function to check if an element is a direct or indirect parent of a relevant element
function hasRelevantChild(element: Element) {
    if (isRelevantElement(element)) {
        return true;
    }

    for (const child of Array.from(element.children)) {
        if (hasRelevantChild(child)) {
            return true;
        }
    }

    return false;
}


function addRandomIdToElements(doc: Element) {
    for (let i = 0; i < doc.children.length; i++) {
        const child = doc.children[i];
        if (hasRelevantChild(child)) {
            child.setAttribute('x-interactableId', (Math.floor(Math.random() * 9000) + 1000).toString());
            addRandomIdToElements(child);
        }
    }
    return doc;
}


function findAllRelevantElements(doc: Element) {
    const elements = [];
    const allElements = doc.querySelectorAll('*');
    for (const element of Array.from(allElements)) {
        if (isRelevantElement(element)) {
            elements.push(element);
        }
    }

    return elements.map((element) => {
        return {
            id: element.getAttribute('x-interactableId')!,
            xpath: getXPath(element),
            originalId: element.getAttribute('id') ?? null,
            element: element
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
    originalId: string | null;
};
async function removeInvisibleElements2(element: Element, driver: WebDriver, relevants: RelevantThingsInfo[]) {

    await driver.executeScript(`window.document.documentElement.style.setProperty("scroll-behavior", "auto", "important")`)
    let counter = 0;
    let discardCounter = 0;
    for (const relevant of relevants) {
        const byExpression = By.xpath(relevant.xpath);
        const foundElement = await driver!.findElement(byExpression);

        if (foundElement) {
            try {
                let isElementInteractable: boolean = await driver.executeScript(`
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
                
                let xpath = arguments[0].xpath;
                let id = arguments[0].id;
                let el = getElementByXpath(xpath);
                if (el) {
                    el.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
                    return isElementInteractable(el);
                }
                return true;`, relevant);

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
    const body = ogDoc.getElementsByTagName('body')[0];
    let cleanHtml = addRandomIdToElements(body);
    let allRelevantElements = findAllRelevantElements(cleanHtml);

    await removeInvisibleElements2(cleanHtml, driver, allRelevantElements);

    let clickables = allRelevantElements
        .filter((relevant) => interactableElements.includes(relevant.element.tagName.toLowerCase()))
        .map((entries) => {
            return {
                id: entries.element.getAttribute('x-interactableId')!,
                xpath: entries.xpath,
                originalId: entries.element.getAttribute('id') ?? null,
            }
        });


    let finalHtml2 = cleanHtml;


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

    const markdown = turndownService.turndown(finalHtml2.outerHTML);
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