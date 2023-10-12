import { PromptTemplate } from "langchain/prompts";

const _DEFAULT_SUMMARIZER_TEMPLATE = `Copy the following conversation between two individuals. 

Remove irrelevant details and prioritize keeping important information and context.
Important! Keep the same conversation format!
-------
Example expected output format:

Start-Of-Message:
- Participant: The participant's name
- Task: The name of the task being done.
- Payload: A text payload or JSON.

------
Simplify overly verbose text. 
Only simplify the "Payload", leaving the rest of the fields intact.
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
