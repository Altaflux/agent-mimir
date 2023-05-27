type XpathComponent = {
    name?: string,
    position?: number | null
}

export function getXPath(node: Element) {
    var comp, comps : XpathComponent[] = [];
    var xpath = '';
    var getPos = function (node: Element) {
        var position = 1, curNode;
        if (node.nodeType == node.ATTRIBUTE_NODE) {
            return null;
        }
        for (curNode = node.previousSibling; curNode; curNode = curNode.previousSibling) {
            if (curNode.nodeName == node.nodeName) {
                ++position;
            }
        }
        return position;
    }
    let nodeToFind: Element | null = node;
    for (; nodeToFind && !(nodeToFind.nodeType === nodeToFind.DOCUMENT_NODE); nodeToFind = nodeToFind.nodeType == nodeToFind.ATTRIBUTE_NODE ? (nodeToFind as any).ownerElement : nodeToFind.parentNode) {
        
        let comp: XpathComponent | null  = comps[comps.length] = {};
        switch (nodeToFind.nodeType) {
            case nodeToFind.TEXT_NODE:
                comp.name = 'text()';
                break;
            case nodeToFind.ATTRIBUTE_NODE:
                comp.name = '@' + nodeToFind.nodeName;
                break;
            case nodeToFind.PROCESSING_INSTRUCTION_NODE:
                comp.name = 'processing-instruction()';
                break;
            case nodeToFind.COMMENT_NODE:
                comp.name = 'comment()';
                break;
            case nodeToFind.ELEMENT_NODE:
                comp.name = nodeToFind.nodeName;
                if (nodeToFind.hasAttribute('id')) {
                  comp.name = '/*[@id="' + nodeToFind.getAttribute('id') + '"]';
                  nodeToFind = null; 
                }
                break;
        }
        if (!nodeToFind) {
            break; 
        } else {
            comp.position = getPos(nodeToFind);
        }
    }

    for (var i = comps.length - 1; i >= 0; i--) {
        comp = comps[i];
        xpath += '/' + comp.name;
        if (comp.position) {
            xpath += '[' + comp.position + ']';
        }
    }

    return xpath;

}
