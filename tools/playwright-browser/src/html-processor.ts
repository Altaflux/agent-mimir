import { JSDOM } from 'jsdom';
import { getXPath } from './xpath.js';
import { Page } from 'playwright';

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

function removeIdsFromInvisibleElements(doc: Element, ids: string[]) {
    const allElements = doc.querySelectorAll('*');
    for (const element of Array.from(allElements)) {
        if (element.hasAttribute('x-interactableId') && !ids.includes(element.getAttribute('x-interactableId')!)) {
            element.removeAttribute('x-interactableId');
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

async function findAllRelevantElements(doc: Element, driver: Page, document: Document, scrollPosition: number ) {
    const allElements = doc.querySelectorAll('*');
    const currentScrollBlock = await driver.evaluate(async () => document.documentElement.scrollTop || document.body.scrollTop);
    const htmlElements = ((Array.from(allElements)
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
        })));

    const map: Map<string, Element> = htmlElements.reduce(function (map, object) {
        if (!map.has(object.id)) {
            return map.set(object.id, object.element);
        }
        return map;
    }, new Map);
    const minimalHtmlInformation = htmlElements.map(e => ({
        id: e.id,
        type: e.type,
        xpath: e.xpath
    }));



    const htmlElementInformation: {
        id: string, xpath: string, type: RelevantElement, location: { top: number, left: number, isViewable: boolean }
    }[] = ((await driver.evaluate(async (elements) => {
        function isElementUnderOverlay(element: Element) {
            const rect = element.getBoundingClientRect();
            const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);

            //return topElement !== element && !element.contains(topElement) && topElement?.tagName !== 'HTML';
            return topElement !== element && !element.contains(topElement);
        }
        function isElementClickable(element: Element) {
            const styles = getComputedStyle(element);
            return styles.pointerEvents !== 'none';
        }
        function getElementByXpath(path: string) {
            return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element;
        }
        const elementIsVisibleInViewport = (el: Element, partiallyVisible = false) => {
            const { top, left, bottom, right } = el.getBoundingClientRect();
            const { innerHeight, innerWidth } = window;
            const result = partiallyVisible
                ? ((top > 0 && top < innerHeight) ||
                    (bottom > 0 && bottom < innerHeight)) &&
                ((left > 0 && left < innerWidth) || (right > 0 && right < innerWidth))
                : top >= 0 && left >= 0 && bottom <= innerHeight && right <= innerWidth;
            return result;
        };

        function getOffset(el: Element) {
            const rect = el.getBoundingClientRect();
            const scrollOffset = document.documentElement.scrollTop || document.body.scrollTop;
            return {
                left: rect.left,
                top: rect.top //+ scrollOffset - elements.scrollPosition
            };
        }
      
        const results = elements.elements.map((info) => {
            const webDriverElement = getElementByXpath(info.xpath);
            if (!webDriverElement) {
                return null;
            }
            window.document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
            //webDriverElement.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
            const rect = getOffset(webDriverElement);
            const isViewable = !isElementUnderOverlay(webDriverElement) && isElementClickable(webDriverElement) && elementIsVisibleInViewport(webDriverElement);
    
            return {
                ...info,
                location: {
                    top: rect.top,
                    left: rect.left,
                    isViewable: isViewable
                }
            };
        });
        //await driver.evaluate(async () => window.scroll(0, currentScrollBlock));
        return results
    }, {
        elements: minimalHtmlInformation,
        scrollPosition: scrollPosition
    })) as any[]).filter((e) => e !== null);

    await driver.evaluate(async (currentScrollBlock: number) => window.scroll(0, currentScrollBlock), currentScrollBlock);
    const elements = htmlElementInformation.map((el) => ({ ...el, element: map.get(el.id)! }));

    for (const foundElement of elements) {
        if (!foundElement.location.isViewable) {
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
export async function extractHtml(html: string, driver: Page,) {
    const ogDoc = new JSDOM(html).window.document;

    let cleanHtml = convertPicturesToImages(ogDoc.body);
    cleanHtml = addRandomIdToElements(ogDoc.body);
    let allRelevantElements = await findAllRelevantElements(cleanHtml, driver, ogDoc, 0);
    cleanHtml = removeIdsFromInvisibleElements(ogDoc.body, allRelevantElements.map((e) => e.id));
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
    cleanHtml = removeIdsFromInvisibleElements(ogDoc.body, interactables.map((e) => e.id));
    return {
        html: ogDoc,
        interactableElements: interactables.reduce((map, obj) => map.set(obj.id, obj), new Map())
    }
}
