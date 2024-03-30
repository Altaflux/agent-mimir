import { JSDOM } from 'jsdom';
import { getXPath } from './xpath.js';
import { By, WebDriver, WebElement } from 'selenium-webdriver';

const selectableElements = ['input', 'select', 'textarea'];
const clickableElements = ['a', 'button', 'link'];
const interactableElements = [...selectableElements, ...clickableElements];
const persistableElements = ['img', ...interactableElements, (element: Element) => {
    return (element.childNodes.length > 0 &&
        element.childNodes[0].nodeType === element.TEXT_NODE &&
        element.childNodes[0].textContent?.trim() !== '')
}];

export type RelevantElement = "input" | "clickable" | "text";

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

function convertPicturesToImages(doc: Element) {
    const allElements = doc.querySelectorAll('picture');
    for (const pictureElement of Array.from(allElements)) {
        const img = pictureElement.querySelector('img')
        const alt = img?.getAttribute('alt');
        if (!alt || alt === '') {
            pictureElement.replaceWith();
        }
        if (img) {
            pictureElement.replaceWith(img);
        }
    }
    return doc;
}

async function findAllRelevantElements(doc: Element, driver: WebDriver, document: Document) {
    const allElements = doc.querySelectorAll('*');

    const htmlElements = (await Promise.all(Array.from(allElements)
        .filter((e) => isRelevantElement(e))
        .map(async (element) => {
            const tag = element.tagName.toLowerCase();
            const type = (selectableElements.includes(tag) ? 'input' : interactableElements.includes(tag) ? 'clickable' : 'text') as RelevantElement;
            const xpath = getXPath(element);
            const byExpression = By.xpath(xpath);
            let webDriverElement = undefined;
            try {
                webDriverElement = await driver!.findElement(byExpression)
            } catch (e) {
                //
            }
            return {
                id: element.getAttribute('x-interactableId')!,
                xpath: getXPath(element),
                element: element,
                type: type,
                webDriverElement: webDriverElement,
            }
        }))).filter(e => e.webDriverElement !== undefined);


    //const map = new Map<string, Element>();
    const map: Map<string, Element> = htmlElements.reduce(function (map, object) {
        if (!map.has(object.id)) {
            return map.set(object.id, object.element);
        }

        return map;
    }, new Map);
    const htmlElementInformation: {
        id: string, xpath: string, element: Element, webDriverElement: WebElement, type: RelevantElement, location: { top: number, left: number, isViewable: boolean }
    }[] = await driver.executeScript(`
            function isElementUnderOverlay(element) {
                const rect = element.getBoundingClientRect();
                const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return topElement !== element && !element.contains(topElement);
            }
            
            function isElementClickable(element) {
                const styles = getComputedStyle(element);
                return styles.pointerEvents !== 'none';
            }
            
            const elementIsVisibleInViewport = (el, partiallyVisible = false) => {
                const { top, left, bottom, right } = el.getBoundingClientRect();
                const { innerHeight, innerWidth } = window;
                const result = partiallyVisible
                ? ((top > 0 && top < innerHeight) ||
                    (bottom > 0 && bottom < innerHeight)) &&
                    ((left > 0 && left < innerWidth) || (right > 0 && right < innerWidth))
                : top >= 0 && left >= 0 && bottom <= innerHeight && right <= innerWidth;
                return result;
            };
            
            function getOffset(el) {
                const rect = el.getBoundingClientRect();
                return {
                left: rect.left,
                top: rect.top
                };
            }
            
            
            let elements = arguments[0];
            
            return elements.map((info) => {
                const rect = getOffset(info.webDriverElement);
                return {
                    ...info,
                    location: {
                        top: rect.top,
                        left: rect.left,
                        isViewable: !isElementUnderOverlay(info.webDriverElement) && isElementClickable(info.webDriverElement) && elementIsVisibleInViewport(info.webDriverElement)
                    }
                };
            });
        `, htmlElements)

    const elements = htmlElementInformation.map((el) => ({ ...el, element: map.get(el.id)! }));

    for (const foundElement of elements) {
        if (!foundElement.location.isViewable) {
            //let elementToRemove = foundElement.element;
            let elementToRemove = foundElement.element;
            if (elementToRemove) {
                try {
                    elementToRemove.remove();
                } catch (ee) {
                    console.error("Failed to remote, ", ee);
                }

            }
        }
    }
    return elements.filter((e) => e.location.isViewable);

}


export type InteractableElement = {
    id: string;
    xpath: string;
    type: RelevantElement;
    location: {
        top: number;
        left: number;
    }
}
export async function extractHtml(html: string, driver: WebDriver) {
    const ogDoc = new JSDOM(html).window.document;

    let cleanHtml = convertPicturesToImages(ogDoc.body);
    cleanHtml = addRandomIdToElements(ogDoc.body);
    let allRelevantElements = await findAllRelevantElements(cleanHtml, driver, ogDoc);

    let interactables = allRelevantElements
        .filter((relevant) => (relevant.element !== null) && interactableElements.includes(relevant.element.tagName.toLowerCase()))
        .map((entries) => {
            return {
                id: entries.id,
                xpath: entries.xpath,
                type: entries.type,
                location: entries.location,
            } as InteractableElement
        });

    return {
        html: ogDoc,
        interactableElements: interactables.reduce((map, obj) => map.set(obj.id, obj), new Map())
    }
}
