import { PromptTemplate } from "langchain/prompts";

const _DEFAULT_SUMMARIZER_TEMPLATE = `Copy the following conversation between two individuals. 
Keep the same conversation format.
Remove irrelevant details and prioritize keeping important information and context.
Simplify overly verbose text. 
The copy should be half the length of the original conversation.



Start of the conversation:
----------------------
{conversation}
---------------

Start of the copy version:`;

// eslint-disable-next-line spaced-comment
export const COMPACT_PROMPT = /*#__PURE__*/ new PromptTemplate({
  inputVariables: ["conversation"],
  template: _DEFAULT_SUMMARIZER_TEMPLATE,
});
