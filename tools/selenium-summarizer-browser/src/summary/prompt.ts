
import {
  PromptTemplate,
} from "langchain/prompts";

const _DEFAULT_SUMMARIZER_TEMPLATE = `Rewrite the following markdown by keeping only content related to "{focus}": 
The result should be in Markdown format.
The document should focus in the following information: "{focus}". 
Include up to 10 html inputs, buttons and link elements that are relevant (always including all attributes and text). Do not rewrite or simplify the html elements!.

If there is no relevant information included in this document, respond an empty document.

-------------------------
This is the Markdown:

{text}

Rewritten Markdown:
`;
//be a smaller and more compact version of the original
// eslint-disable-next-line spaced-comment
export const SUMMARY_PROMPT = /*#__PURE__*/ new PromptTemplate({
  inputVariables: ["focus", "text"],
  template: _DEFAULT_SUMMARIZER_TEMPLATE,
});

/////////////////////////////////////////

const refinePromptTemplate = 
`Rewrite the following markdown by keeping only content related to "{focus}": 
The result should be in Markdown format.
The document should focus in the following information: "{focus}". 
Include up to 10 html inputs, buttons and link elements that are relevant (always including all attributes and text). Do not rewrite or simplify the html elements!.

-------------------------

Your job is to produce a new Markdown format version of the Markdown document.
We have provided an existing revision up to a certain point:
"{existing_answer}"


We have the opportunity to add and refine the existing Markdown document (only if needed) with some more context below.
------------
"{text}"
------------

Given the new piece of Markdown, refine the response.
If the context isn't useful, return the original document.

Rewritten Markdown:`;

export const REFINE_PROMPT = /* #__PURE__ */ new PromptTemplate({
  template: refinePromptTemplate,
  inputVariables: ["existing_answer", "text", "focus"],
});
