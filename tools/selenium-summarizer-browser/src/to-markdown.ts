import TurndownService from 'turndown';

function buildAttribute(attributeName: string, attributeValue: string | null, defaultValue?: string) {
    if (attributeValue) {
        return `${attributeName}="${attributeValue}"`;
    } else if (defaultValue) {
        return `${attributeName}="${defaultValue}"`;
    }
    return "";
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
        const labelledByElement = document.querySelector(`[id="${ariaLabelledBy}"]`);
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

function applyTurndownFixes(htmlDoc: Document) {
    //Turndown incorrectly does not mark <textarea> elements as void elements thus discarding them. 
    //By setting a value inside the textarea, we can force turndown to treat it as a non-blank element.
    for (const textArea of htmlDoc.getElementsByTagName('textarea')) {
        if (/^\s*$/i.test(textArea.textContent ?? '')) {
            textArea.textContent = "*";
        }
    }
}

export function htmlToMarkdown(htmlDoc: Document) {

    const turndownService = new TurndownService()
        .addRule('formatLink', {
            filter: ['a'],
            replacement: function (content, node, options) {
                let element = node as HTMLElement;
                const description = getInputorLinkInfo(htmlDoc, element);
                if (description) {
                    return `<a ${buildAttribute("id", element.getAttribute('x-interactableId'))}>${description}</a>`
                }
                return "";
            }
        }).addRule('formatButton', {
            filter: ['button'],
            replacement: function (content, node, options) {
                let element = node as HTMLElement;
                const description = getInputorLinkInfo(htmlDoc, element);
                if (description) {
                    return `<button ${buildAttribute("type", element.getAttribute('type'), "button")} ${buildAttribute("id", element.getAttribute('x-interactableId'))}>${description}</button>`
                }
                return "";
            }
        }).addRule('textarea', {
            filter: ['textarea'],
            replacement: function (content, node, options) {
                let element = node as HTMLElement;
                const description = getInputorLinkInfo(htmlDoc, element);
                if (description) {
                    return `<textarea ${buildAttribute("aria-label", description)} ${buildAttribute("id", element.getAttribute('x-interactableId'))}>${description}</textarea>`
                }
                return "";
            }
        }).addRule('removeScript', {
            filter: ['script'],
            replacement: function () {
                return "";
            }
        }).addRule('formatInput', {
            filter: ['input'],
            replacement: function (_, node) {
                let element = node as HTMLElement;
                const description = getInputorLinkInfo(htmlDoc, element);
                if (description) {
                    return `<input ${buildAttribute("type", element.getAttribute('type'), "text")} ${buildAttribute("aria-label", description)} ${buildAttribute("name", element.getAttribute('name'))}  ${buildAttribute("id", element.getAttribute('x-interactableId'))}></input>`
                }
                return "";
            }
        });

    applyTurndownFixes(htmlDoc);
    const markdown = turndownService.turndown(htmlDoc.body.outerHTML);
    return markdown;
}