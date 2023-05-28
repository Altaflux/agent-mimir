

import {
    PromptTemplate,
} from "langchain/prompts";



const _DEFAULT_SUMMARIZER_TEMPLATE2 = `Respond me with a number between 1 and 10 that rank if the following piece of a website is relevant to: {focus}"
------------
Piece of website: 

{document}

------------
Was that piece of the website relevant?:
`;
export const RELEVANCE_PROMPT = /* #__PURE__ */ new PromptTemplate({
    template: _DEFAULT_SUMMARIZER_TEMPLATE2,
    inputVariables: ["document", "focus"],
});
