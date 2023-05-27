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
        })
        .addRule('formatButton', {
            filter: ['button'],
            replacement: function (content, node, options) {
                let element = node as HTMLElement;
                const description = getInputorLinkInfo(htmlDoc, element);
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
                const description = getInputorLinkInfo(htmlDoc, element);
                if (description) {
                    return `<input ${buildAttribute("type", element.getAttribute('type'), "text")} ${buildAttribute("name", element.getAttribute('name'))}  ${buildAttribute("id", element.getAttribute('x-interactableId'))} >${description}</input>`
                }
                return "";
            }
        });

    const markdown = turndownService.turndown(htmlDoc.body.outerHTML);
    return markdown;
}