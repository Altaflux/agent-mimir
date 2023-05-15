import { JSDOM } from 'jsdom';
import { getXPath } from './xpath-finder.js';
import { load } from 'cheerio';

const persistableElements = ['a', 'button', 'input', 'link'];
function removeAttributesExcept(htmlString: string) {
    // const parser = new DOMParser();
    // const doc = parser.parseFromString(htmlString, 'text/html');
    const doc = new JSDOM(htmlString).window.document;
    const allElements = doc.querySelectorAll('*');

    for (const element of Array.from(allElements)) {
        const attrs = Array.from(element.attributes);
        for (const attr of attrs) {
            if (attr.name !== 'aria-label' && !(attr.name === 'id' && persistableElements.includes(element.tagName.toLowerCase()))) {
                element.removeAttribute(attr.name);
            }
        }
    }

    return doc.documentElement.outerHTML;
}

function createLeanHtml(htmlString: string) {
    // Create a DOM parser to parse the HTML string
    //   const parser = new DOMParser();
    const doc = new JSDOM(htmlString).window.document;

    // Function to check if an element is a button, link or has readable text
    function isRelevantElement(element: Element) {
        return (
            element.tagName.toLowerCase() === 'button' ||
            element.tagName.toLowerCase() === 'input' ||
            element.tagName.toLowerCase() === 'a' ||
            (element.childNodes.length === 1 &&
                element.childNodes[0].nodeType === 3 &&  //3 is for Text Node (Node.TEXT_NODE)
                element.childNodes[0].textContent?.trim() !== '')
        );
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

    // Function to remove specific unwanted elements
    function removeUnwantedElements(element: Document, tagsToRemove: string[]) {
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
    removeIrrelevantElements(doc.body);

    // Return the leaner HTML document
    return '<!DOCTYPE html>\n<html>\n' + doc.body.outerHTML + '\n</html>';
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

function addRandomIdToElements(htmlString: string) {
    // const parser = new DOMParser();
    //  const doc = parser.parseFromString(htmlString, 'text/html');
    const doc = new JSDOM(htmlString).window.document;

    const elements = doc.querySelectorAll(persistableElements.join(', '));

    elements.forEach(element => {
        if (element.getAttribute('id')) {
            element.setAttribute('originalId', `${element.getAttribute('id')!}`);
        }
        element.setAttribute('id', getRandomId().toString());
    });

    return '<!DOCTYPE html>\n<html>\n' + doc.head.outerHTML + '\n' + doc.body.outerHTML + '\n</html>';
    // const updatedHtml = new XMLSerializer().serializeToString(doc);
    // return updatedHtml;
}

// export function doAll(html: string) {
//     return addRandomIdToElements(compactHTML(removeAttributesExcept(createLeanHtml(html)))).replaceAll("\n", "").replaceAll("\t", "");

// }

export function doAllNew(html: string) {
    return compactHTML(removeAttributesExcept(createLeanHtml(html))).replaceAll("\n", "").replaceAll("\t", "");

}

function findIDs(inputString: string) {
    var regex = /id="([^"]*)"/g;
    var result;
    var ids = [];

    while ((result = regex.exec(inputString)) !== null) {
        ids.push(result[1]);
    }

    return ids;
}

function getInputs(html: string) {

    // const $ = load(html);
    // const inputs = $('input, button');
    const dom = new JSDOM(html);
    const document = dom.window.document;
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

    // inputsAndLabels.forEach(({ element }, i) => {
    //     if (element.getAttribute('id') !== null) {
    //         element.setAttribute('originalId', element.getAttribute('id')!);
    //     }
    //     element.setAttribute('id', getRandomId().toString());
    // });

    const listOfInputs = inputsAndLabels.map((input) => {
        return {
            description: input.description!,
            id: input.element.getAttribute('id')!,
            xpath: getXPath(input.element),
            type: input.type,
            originalId: input.element.getAttribute('originalId') ?? null,
        }
    });

    return listOfInputs;
    // let doc = new JSDOM(html).window.document;
    // const elements = doc.querySelectorAll('input');
    // let inputs = Array.from(elements).map((element) => {
    //     if (element.getAttribute('type') === 'text') {

    //     }
    //     return {
    //         id: element.getAttribute('id')!,
    //         xpath: getXPath(element)
    //     }
    // });
}
export function clickables(html: string) {
    let cleanHtml = addRandomIdToElements((html));
  //  let cleanHtml = html;
    let doc = new JSDOM(cleanHtml).window.document;
    const elements = doc.querySelectorAll('a, link');
    let clickables = Array.from(elements).map((element) => {
        return {
            id: element.getAttribute('id')!,
            xpath: getXPath(element),
            originalId: element.getAttribute('originalId') ?? null,
        }
    });
    const inputs = getInputs(cleanHtml);
    return {
        html: doAllNew(cleanHtml),
        clickables: clickables,
        inputs: inputs
    }
}
