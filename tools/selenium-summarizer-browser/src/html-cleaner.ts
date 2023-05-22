import { JSDOM } from 'jsdom';
import { getXPath } from './xpath-finder.js';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import { is } from 'cheerio/lib/api/traversing.js';


//import { TurndownService } from 'turndown';
const persistableElements = ['a', 'button', 'input', 'link', 'select', 'textarea', (element: Element) => {
    return (element.childNodes.length === 1 &&
        element.childNodes[0].nodeType === 3 &&  //3 is for Text Node (Node.TEXT_NODE)
        element.childNodes[0].textContent?.trim() !== '')
}];
const inputElements = ['button', 'input', 'select', 'textarea'];

function isPersistableElement(element: Element) {
    let isPersistable = persistableElements.find((e) => {
        if (typeof e === 'string') {
            return e === element.tagName.toLowerCase();
        } else if (typeof e === 'function') {
            return e(element);
        }
    });
    return isPersistable !== undefined;
}
function removeAttributesExcept(doc: Element) {
    // const parser = new DOMParser();
    // const doc = parser.parseFromString(htmlString, 'text/html');
    //  const doc = new JSDOM(htmlString).window.document;
    const allElements = doc.querySelectorAll('*');

    for (const element of Array.from(allElements)) {
        const attrs = Array.from(element.attributes);
        for (const attr of attrs) {
            if (true
                && attr.name !== 'aria-label'
                //   && !(attr.name === 'href' && persistableElements.includes(element.tagName.toLowerCase()))
                //  && !(persistableElements.includes(element.tagName.toLowerCase()) && attr.name !== 'href')
                && !((attr.name === 'type' || attr.name === 'name' || attr.name === 'value') && inputElements.includes(element.tagName.toLowerCase()))
                && !(attr.name === 'id' && isPersistableElement(element))) {
                element.removeAttribute(attr.name);
            }
        }
    }

    return doc;
}


// Function to check if an element is a button, link or has readable text
function isRelevantElement(element: Element) {
    return (
        isPersistableElement(element)
    );
}

// Function to check if an element is a direct or indirect parent of a relevant element
function hasRelevantChild(element: Element) {
    if (isRelevantElement(element)) {
        element.setAttribute('referenceId', getRandomId().toString());
        return true;
    }

    for (const child of Array.from(element.children)) {
        if (hasRelevantChild(child)) {
            return true;
        }
    }

    return false;
}

function createLeanHtml(doc: Element) {
    // Create a DOM parser to parse the HTML string
    //   const parser = new DOMParser();



    // Function to remove specific unwanted elements
    function removeUnwantedElements(element: Element, tagsToRemove: string[]) {
        for (const tag of tagsToRemove) {
            const unwantedElements = element.getElementsByTagName(tag);
            while (unwantedElements.length > 0) {
                unwantedElements[0].parentNode?.removeChild(unwantedElements[0]);
            }
        }
    }

    // Remove unwanted elements from the parsed HTML document
    removeUnwantedElements(doc, ['style', 'script', 'svg']);

    // Recursive function to remove irrelevant elements
    function removeIrrelevantElements(element: Element) {
        for (let i = 0; i < element.children.length; i++) {
            const child = element.children[i];

            if (!hasRelevantChild(child)) {
                child.remove();
                i--; // Adjust index after removing element
            } else {
                removeIrrelevantElements(child);
            }
        }
    }

    // Remove irrelevant elements from the body of the parsed HTML document
    removeIrrelevantElements(doc);

    // Return the leaner HTML document
    return doc;
}


///
export function compactHTML(html: string) {
    // Parse the HTML string
    // const parser = new DOMParser();
    //const doc = parser.parseFromString(html, "text/html");
    html = html.replace(/[\r\n]+/g, '').replace(/\s{2,10}/g, ' ');
    html = html.replace(/<!--.*?-->/g, '');

    const doc = new JSDOM(html).window.document;
    // Recursive function to compact the HTML tree
    function compactNode(node: Element) {
        if (node.children.length === 1 && node.tagName !== 'BODY') {
            const child = node.children[0];
            node.replaceWith(child);
            compactNode(child);
        } else {
            for (let i = 0; i < node.children.length; i++) {
                compactNode(node.children[i]);
            }
        }
    }

    // Compact the root node
    compactNode(doc.body);

    // Serialize the modified document back to an HTML string
    return '<!DOCTYPE html>\n<html>\n' + doc.body.outerHTML + '\n</html>';
    // const serializer = new XMLSerializer();
    // return serializer.serializeToString(doc);
}

function getRandomId() {
    return Math.floor(Math.random() * 9000) + 1000;
}

function addRandomIdToElements(doc: Element) {
    // const parser = new DOMParser();
    //  const doc = parser.parseFromString(htmlString, 'text/html');
    //const doc = new JSDOM(htmlString).window.document;

    for (let i = 0; i < doc.children.length; i++) {
        const child = doc.children[i];

        if (!hasRelevantChild(child)) {
            // child.remove();
            // i--; // Adjust index after removing element
        } else {
            child.setAttribute('referenceId', getRandomId().toString());
            addRandomIdToElements(child);
        }
    }
    // const elements = doc.querySelectorAll(persistableElements.filter(e => typeof e === 'string').join(', '));

    // elements.forEach(element => {
    //     element.setAttribute('referenceId', getRandomId().toString());
    // });

    return doc;
}
function moveIdToCorrectLocation(doc: Element) {


    for (let i = 0; i < doc.children.length; i++) {
        const child = doc.children[i];

        if (!hasRelevantChild(child)) {
            // child.remove();
            // i--; // Adjust index after removing element
        } else {
            if (child.getAttribute('referenceId')) {
                child.setAttribute('id', `${child.getAttribute('referenceId')!}`);
            }
            moveIdToCorrectLocation(child);
        }
    }

    //  const doc = new JSDOM(htmlString).window.document;

    const elements = doc.querySelectorAll(persistableElements.filter(e => typeof e === 'string').join(', '));

    elements.forEach(element => {
        if (element.getAttribute('referenceId')) {

            element.setAttribute('id', `${element.getAttribute('referenceId')!}`);
        }
    });

    return doc;
}



// export function doAllNew(html: string) {
//     return compactHTML(removeAttributesExcept(createLeanHtml(html))).replaceAll("\n", "").replaceAll("\t", "");
// }

export function doAllNew2(html: Element) {
    return (removeAttributesExcept(createLeanHtml(html)));

}


function getInputs(document: ParentNode) {


    const inputs = Array.from(document.querySelectorAll('input, button'));

    const inputsAndLabels = inputs
        .map(input => {
            const tagName = input.tagName.toLocaleLowerCase();
            let attributeType;
            if (tagName === 'input') {
                attributeType = input.getAttribute('type') ?? 'text';
            } else if (tagName === 'button') {
                attributeType = input.getAttribute('type') ?? 'button';
            }
            const type = `"${tagName}" - Input Type: "${attributeType ?? ""}"`;
            return {
                element: input,
                type: type
            }
        })
        .map((input, i) => {
            const ariaLabel = input.element.getAttribute('aria-label');
            if (ariaLabel && ariaLabel !== '') {
                return {
                    ...input,
                    description: ariaLabel!
                }
            }
            const ariaLabelledBy = input.element.getAttribute('aria-labelledby');
            if (ariaLabelledBy) {
                const labelledByElement = document.querySelectorAll(`#${ariaLabelledBy}`)  //  $(`#${ariaLabelledBy}`);
                if (labelledByElement.length > 0) {
                    if (!labelledByElement[0].textContent) {
                        console.log(`No text content for aria-labelledby ${ariaLabelledBy}`);
                    }
                    return {
                        ...input,
                        description: labelledByElement[0].textContent?.trim()
                    }
                }
            } else if (input.element.tagName.toLocaleLowerCase() === 'button' && input.element.textContent) {
                return {
                    ...input,
                    description: input.element.textContent.trim()
                }
            }
            return {
                ...input,
                description: null
            }
        })
        .filter(input => input.description !== null);



    const listOfInputs = inputsAndLabels.map((input) => {
        return {
            description: input.description!.replaceAll("\n", " ").replaceAll(/ +/g, ' '),
            id: input.element.getAttribute('referenceId')!,
            xpath: getXPath(input.element),
            type: input.type,
            originalId: input.element.getAttribute('id') ?? null,
        }
    });

    return listOfInputs;

}

function removeNonInteractableElements(element: Element, theDoc: Document) {
    const elements = element.querySelectorAll('*');

    elements.forEach(element => {
        if (!isElementInteractable(element, theDoc)) {
            element.remove();
        }
    });
    return element;
}

function isElementUnderOverlay(element: Element, theDoc: Document) {
    const rect = element.getBoundingClientRect();
    const middleX = rect.left + rect.width / 2;
    const middleY = rect.top + rect.height / 2;
    const topElement = theDoc.elementFromPoint(middleX, middleY);
    return topElement !== element && !element.contains(topElement);
}

function isElementClickable(element: Element, theDoc: Document) {
    const styles = getComputedStyle(element);
    return styles.pointerEvents !== 'none';
}

function isElementInteractable(element: Element, theDoc: Document) {
    return !isElementUnderOverlay(element, theDoc) && isElementClickable(element, theDoc);
}

export function clickables(html: string) {
    const ogDoc = new JSDOM(html).window.document;
    const body = ogDoc.getElementsByTagName('body')[0];
    let cleanHtml = addRandomIdToElements(body);
    //let cleanHtml = body;
    //  let cleanHtml = html;
    // let doc = new JSDOM(cleanHtml).window.document;
    const elements = cleanHtml.querySelectorAll('a, link');
    let clickables = Array.from(elements).map((element) => {
        return {
            id: element.getAttribute('referenceId')!,
            xpath: getXPath(element),
            originalId: element.getAttribute('id') ?? null,
        }
    });
    const inputs = getInputs(cleanHtml);

    let finalHtml2 = doAllNew2(moveIdToCorrectLocation(cleanHtml));
    //finalHtml2 = removeNonInteractableElements(finalHtml2, ogDoc);

    const turndownService = new TurndownService()
        .addRule('formatLink', {
            filter: ['a'],
            replacement: function (content, node, options) {
                return (node as any).outerHTML;
            }
        })
        .addRule('formatButton', {
            filter: ['button'],
            replacement: function (content, node, options) {
                return (node as any).outerHTML;
            }
        })
        .addRule('formatInput', {
            filter: ['input'],
            replacement: function (content, node, options) {
                return (node as any).outerHTML;
            }
        });
    const markdown = turndownService.turndown(finalHtml2.outerHTML.replaceAll("\n", "").replaceAll("\t", ""));
    console.log("");
    return {
        html: markdown,
        clickables: clickables,
        inputs: inputs
    }
}
