import {
    PromptTemplate,
} from "langchain/prompts";




const  IS_RELEVANT_PROMPT_TEMPLATE = `Respond me with a either the word "true" or "false" depending if the following piece of a website is relevant to: "{focus}".
"true" if the piece of the website is relevant or is significantly related to the piece of the website, "false" if it is not.

The title of the website is "{title}".

Piece of website: 
------------
{document}
------------

Was that piece of the website relevant?:
`;
export const IS_RELEVANT_PROMPT = /* #__PURE__ */ new PromptTemplate({
    template: IS_RELEVANT_PROMPT_TEMPLATE,
    inputVariables: ["document", "focus", "title"],
});


