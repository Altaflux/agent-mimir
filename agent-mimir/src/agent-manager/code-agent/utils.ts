import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ToolResponseInfo } from "../index.js";
import { lCmessageContentToContent } from "../message-utils.js";
import { AiResponseMessage, NextMessageToolResponse } from "../../plugins/index.js";
import { extractTextContent } from "../../utils/format.js";
import { ResponseFieldMapper } from "../../utils/instruction-mapper.js";
import { v4 } from "uuid";


//TODO: remove this when we have a better way to handle this
export function getExecutionCodeContentRegex(xmlString: string): string | null {
  if (typeof xmlString !== 'string') {
    console.error("Input must be a string.");
    return null;
  }

  // Regex explanation:
  // <execution-code> : Matches the literal opening tag.
  // (          : Start capturing group 1 (this is what we want to extract).
  //   .*?      : Matches any character (.), zero or more times (*), non-greedily (?).
  //              Non-greedy is important to stop at the *first* closing tag.
  // )          : End capturing group 1.
  // <\/execution-code> : Matches the literal closing tag (the '/' needs escaping).
  // s          : Flag to make '.' match newline characters as well (dotall).
  const regex = /<execution-code>(.*?)<\/execution-code>/s;

  const match = xmlString.match(regex);

  // If a match is found, match will be an array.
  // match[0] is the full matched string (e.g., "<execution-code>content</execution-code>")
  // match[1] is the content of the first capturing group (e.g., "content")
  if (match && match[1] !== undefined) {
    let scriptCode: string | null = match[1];
    scriptCode = scriptCode.trim().length === 0 ? null : scriptCode; // Trim whitespace from the captured content
    return scriptCode; // Return the captured content
  } else {
    return null; // Tag not found or content is missing somehow
  }
}


export function getLibrariesContentRegex(xmlString: string): string[] {
  if (typeof xmlString !== 'string') {
    console.error("Input must be a string.");
    return [];
  }

  // Regex explanation:
  // <execution-code> : Matches the literal opening tag.
  // (          : Start capturing group 1 (this is what we want to extract).
  //   .*?      : Matches any character (.), zero or more times (*), non-greedily (?).
  //              Non-greedy is important to stop at the *first* closing tag.
  // )          : End capturing group 1.
  // <\/execution-code> : Matches the literal closing tag (the '/' needs escaping).
  // s          : Flag to make '.' match newline characters as well (dotall).
  const regex = /<pip-dependencies-to-install>(.*?)<\/pip-dependencies-to-install>/s;

  const match = xmlString.match(regex);

  // If a match is found, match will be an array.
  // match[0] is the full matched string (e.g., "<pip-dependencies-to-install>content</pip-dependencies-to-install>")
  // match[1] is the content of the first capturing group (e.g., "content")
  if (match && match[1] !== undefined) {
    let scriptCode: string | null = match[1];
    scriptCode = scriptCode.trim().length === 0 ? null : scriptCode; // Trim whitespace from the captured content
    return scriptCode?.split(",").map(e => e.trim()) ?? []; // Return the captured content
  } else {
    return []; // Tag not found or content is missing somehow
  }
}


export function getTextAfterLastExecutionCode(inputString: string) {
  // Ensure the input is a string
  if (typeof inputString !== 'string') {
    console.error("Input must be a string.");
    return ""; // Return empty string for non-string input
  }

  const endTag = "</execution-code>";

  // Find the index of the *last* occurrence of the closing tag
  const lastIndex = inputString.lastIndexOf(endTag);

  // If the tag wasn't found, there's nothing after it
  if (lastIndex === -1) {
    return "";
  }

  // Calculate the starting position of the text *after* the tag
  // This is the index of the end tag + the length of the tag itself
  const startIndex = lastIndex + endTag.length;

  // Extract the substring from the calculated start index to the end of the string
  // If startIndex is equal to the string length (tag is at the very end),
  // slice() correctly returns an empty string.
  return inputString.slice(startIndex);
}

// export function getTextBeforeFirstExecutionCode(inputString: string) {
//   // Ensure the input is a string
//   if (typeof inputString !== 'string') {
//     console.error("Input must be a string.");
//     return ""; // Return empty string for non-string input
//   }

//   const startTag = "<execution-code>";

//   // Find the index of the *first* occurrence of the opening tag
//   const firstIndex = inputString.indexOf(startTag);

//   // If the tag wasn't found, return the entire string
//   if (firstIndex === -1) {
//     return inputString;
//   }

//   // If the tag was found, extract the portion of the string
//   // from the beginning (index 0) up to the index where the tag starts.
//   // If firstIndex is 0 (tag is at the beginning), slice(0, 0) correctly returns "".
//   return inputString.slice(0, firstIndex);
// }


export function langChainToolMessageToMimirHumanMessage(message: ToolMessage): NextMessageToolResponse {
  return {
    type: "TOOL_RESPONSE",
    toolName: "PYTHON_EXECUTION",
    toolCallId: "N/A",
    content: lCmessageContentToContent(message.contentBlocks)
  };
}


export function aiMessageToMimirAiMessage(aiMessage: AIMessage, files: AiResponseMessage["sharedFiles"], mapper: ResponseFieldMapper): AiResponseMessage {
  const textContent = extractTextContent(aiMessage.contentBlocks);
  const scriptCode = getExecutionCodeContentRegex(textContent);
  const libraries = getLibrariesContentRegex(textContent);
  const userContent = mapper.getUserMessage(lCmessageContentToContent(aiMessage.contentBlocks));

  const mimirMessage: AiResponseMessage = {
    id: aiMessage.id ?? v4(),
    content: userContent.tagFound ? userContent.result : scriptCode ? [] : [{ type: "text", text: textContent }],
    toolCalls: [],
    sharedFiles: files
  };

  if (scriptCode) {
    mimirMessage.toolCalls = [
      {
        id: "N/A",
        toolName: "PYTHON_EXECUTION",
        input: JSON.stringify({
          libraries: libraries,
          script: scriptCode
        })
      },
    ]
  }
  return mimirMessage;
}



export function toPythonFunctionName(input: string): string {
  // 1. Replace invalid characters with underscore
  let sanitized = input.replace(/[^A-Za-z0-9_]/g, '_');

  // 2. If it starts with a digit, prefix an underscore
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  // 3. Ensure it’s not empty (optional—returns '_' if input was all invalid)
  return sanitized.length > 0 ? sanitized : '_';
}