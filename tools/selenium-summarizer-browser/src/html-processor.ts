import { JSDOM } from 'jsdom';
import { getXPath } from './xpath.js';
import { By, WebDriver } from 'selenium-webdriver';

const selectableElements = ['input', 'select', 'textarea'];
const clickableElements = ['a', 'button', 'link'];
const interactableElements = [...selectableElements, ...clickableElements];
const persistableElements = [...interactableElements, (element: Element) => {
    return (element.childNodes.length === element.ELEMENT_NODE &&
        element.childNodes[0].nodeType === element.TEXT_NODE && 
        element.childNodes[0].textContent?.trim() !== '')
}];

export type RelevantElements = {
    id: string;
    xpath: string;
    type: RelevantElement;
};

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

async function removeInvisibleElements(element: Element, driver: WebDriver, relevants: RelevantElements[]) {

    for (const relevant of relevants) {
        const byExpression = By.xpath(relevant.xpath);
        let foundElement;
        try {
            foundElement = await driver!.findElement(byExpression);
        } catch (e) {
            continue;
        }
      
        try {
            const isElementInteractable: boolean = await driver.executeScript(`
                window.document.documentElement.style.setProperty("scroll-behavior", "auto", "important");

                function isElementUnderOverlay(element) {
                    const rect = element.getBoundingClientRect();
                    const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return topElement !== element && !element.contains(topElement);
                }

                function isElementClickable(element) {
                    const styles = getComputedStyle(element);
                    return styles.pointerEvents !== 'none';
                }

                let element = arguments[0];
                element.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
                return !isElementUnderOverlay(element) && isElementClickable(element);`, foundElement);

            if (!isElementInteractable) {
                let elementToRemove = element.querySelector(`[x-interactableId="${relevant.id}"]`);
                if (elementToRemove) {
                    elementToRemove.remove();
                }
            }
        } catch (e) {
            continue;
        }
    }
}
export type RelevantElement = "input" | "clickable" | "text";


export type InteractableElement = {
    id: string;
    xpath: string;
    type: RelevantElement;
}
export async function extractHtml(html: string, driver: WebDriver) {
    const ogDoc = new JSDOM(html).window.document;
    let cleanHtml = addRandomIdToElements(ogDoc.body);
    let allRelevantElements = findAllRelevantElements(cleanHtml);

    await removeInvisibleElements(cleanHtml, driver, allRelevantElements);

    let interactables = allRelevantElements
        .filter((relevant) => interactableElements.includes(relevant.element.tagName.toLowerCase()))
        .map((entries) => {
            return {
                id: entries.element.getAttribute('x-interactableId')!,
                xpath: entries.xpath,
                type: entries.type,
            } as InteractableElement
        });
       
    return {
        html: ogDoc,
        interactableElements: interactables.reduce((map, obj) => map.set(obj.id, obj), new Map())
    }
}
