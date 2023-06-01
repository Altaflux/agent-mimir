

import {
    PromptTemplate,
} from "langchain/prompts";

const _DEFAULT_SUMMARIZER_TEMPLATE = `Combine the following two parts of a markdown document into one.
The markdown document is a representation of the contents of a website.
The title of the website is "{title}".

The result should be in Markdown format.
Prioritize content related to the following task I am tryinng to accomplish: "{focus}".
Remove content that is not related to the task.

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
    inputVariables: ["title", "document1", "document2", "focus"],
});
