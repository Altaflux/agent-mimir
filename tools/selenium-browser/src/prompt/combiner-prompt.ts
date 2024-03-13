import { PromptTemplate } from "@langchain/core/prompts";

//Combine the following two parts of a markdown document into one.
const _DEFAULT_SUMMARIZER_TEMPLATE =`Combine the contents of "part 2" of a markdown document with "part 1" of the document.
The document is a representation of the contents of a website.
The title of the website is "{title}".

The result should be in Markdown format.
Prioritize keeping details related to what I intend to find in the site: "{focus}".
Remove details that is not related to what I intend to find.

Include any relevant html inputs, buttons, and link elements (always including all attributes and text). Do not rewrite or simplify the html elements!

Summarize any large pieces of text while keeping key relevant pieces of information.

If the combined document is too long, remove less relevant content from any of the parts of the document.

If the contents of part 2 of the document is irrelevant to what I intend to find and you will not combine any content from it, respond only with the word "DISCARD" and nothing else!
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
