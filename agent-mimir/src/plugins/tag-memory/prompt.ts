import { PromptTemplate } from "@langchain/core/prompts";


const _TAG_EXTRACTION_TEMPLATE = `The following is a previous conversation we had (you are AI and I am the Human). From the following new lines of conversation, extract relevant and important facts. 
Focus on extracting facts from the new lines of conversation that is relevant to the new lines of conversation and use the current summary for context.

If any of the facts being extracted is relevant to the following existing topic then reuse that topic, else define a new topic for that fact.

IMPORTANT! Your response must be conformed with the following JSON schema:
\`\`\`json
{tool_schema}
\`\`\`

Example of a valid response:
\`\`\`json
{{
  "relevantFacts" : [
    {{
      "topic": "grocery shopping",
      "fact": ["Margaret forgot to pick up milk from the store.", "The familiy could not have cereal for breakfast."]
    }}
  ]
}}
\`\`\`


Currently known topics:
{memoryTags}

Current summary:
{summary}

New lines of conversation:
{new_lines}


-----------------
Your JSON response:
`;

// eslint-disable-next-line spaced-comment
export const TAG_EXTRACTION_PROMPT = /*#__PURE__*/ new PromptTemplate({
  inputVariables: ["summary", "new_lines", "memoryTags", "tool_schema"],
  template: _TAG_EXTRACTION_TEMPLATE,
});



const _TAG_FINDER_PROMPT_TEMPLATE = `The following is a previous conversation we had you and I (you are AI and I am the Human), find facts that are relevant to the new lines of the conversation. Use the current summary for context.
If there is no relevant facts related to the new lines of conversations return an empty array in your response.

IMPORTANT! Your response must be conformed with the following JSON schema:
\`\`\`json
{tool_schema}
\`\`\`

Example of a valid response:
\`\`\`json
{{
  "factList" : ["grocery shopping"]
}}
\`\`\`



Here is the list of facts you can choose from: {memoryTags}

Current summary:
{summary}

New lines of conversation:
{new_lines}

-----------------
Your JSON response:

`;

// eslint-disable-next-line spaced-comment
export const TAG_FINDER_PROMPT = /*#__PURE__*/ new PromptTemplate({
  inputVariables: ["summary", "new_lines", "memoryTags", "tool_schema"],
  template: _TAG_FINDER_PROMPT_TEMPLATE,
});
