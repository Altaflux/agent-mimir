

import {
    PromptTemplate,
} from "langchain/prompts";

const _DEFAULT_SUMMARIZER_TEMPLATE = `Combine the following two parts of a markdown documents into one.": 
The result should be in Markdown format.
Prioritize content related to the following: "{focus}".
Discard content that is not related to: "{focus}".
Include any relevant html inputs, buttons, and link elements (always including all attributes and text). Do not rewrite or simplify the html elements!

Summarize any large pieces of text while keeping key relevant pieces of information.

If the combined document is too long, remove less relevant content.

-------------------------
This is part 1 of the document:

{document1}

-------------------------
This is part 2 of the document:

{document2}

-------------------------
Combined Markdown document:
`;
export const COMBINE_PROMPT = /* #__PURE__ */ new PromptTemplate({
    template: _DEFAULT_SUMMARIZER_TEMPLATE,
    inputVariables: ["document1", "document2", "focus"],
});
