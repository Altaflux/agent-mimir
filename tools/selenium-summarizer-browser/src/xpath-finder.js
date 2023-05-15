const ATTRIBUTE_NODE = 2;
const TEXT_NODE = 3;
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;
const ELEMENT_NODE = 1;
const DOCUMENT_NODE = 9;
export function getXPath(node) {
    var comp, comps = [];
    var parent = null;
    var xpath = '';
    var getPos = function (node) {
        var position = 1, curNode;
        if (node.nodeType == ATTRIBUTE_NODE) {
            return null;
        }
        for (curNode = node.previousSibling; curNode; curNode = curNode.previousSibling) {
            if (curNode.nodeName == node.nodeName) {
                ++position;
            }
        }
        return position;
    }

    // if (node instanceof Document) {
    //     return '/';
    // }

    // for (; node && !(node instanceof Document); node = node.nodeType == ATTRIBUTE_NODE ? node.ownerElement : node.parentNode) {
    for (; node && !(node.nodeType === DOCUMENT_NODE); node = node.nodeType == ATTRIBUTE_NODE ? node.ownerElement : node.parentNode) {
        comp = comps[comps.length] = {};
        switch (node.nodeType) {
            case TEXT_NODE:
                comp.name = 'text()';
                break;
            case ATTRIBUTE_NODE:
                comp.name = '@' + node.nodeName;
                break;
            case PROCESSING_INSTRUCTION_NODE:
                comp.name = 'processing-instruction()';
                break;
            case COMMENT_NODE:
                comp.name = 'comment()';
                break;
            case ELEMENT_NODE:
                comp.name = node.nodeName;
                break;
        }
        comp.position = getPos(node);
    }

    for (var i = comps.length - 1; i >= 0; i--) {
        comp = comps[i];
        xpath += '/' + comp.name;
        if (comp.position != null) {
            xpath += '[' + comp.position + ']';
        }
    }

    return xpath;

}