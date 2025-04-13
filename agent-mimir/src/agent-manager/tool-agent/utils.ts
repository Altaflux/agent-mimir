import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { AiResponseMessage, NextMessageToolResponse } from "../../plugins/index.js";
import { lCmessageContentToContent } from "../message-utils.js";
import {  MessageContentToolUse, ToolResponseInfo } from "../index.js";
import { getTextAfterUserResponseFromArray } from "../../utils/format.js";

export function langChainToolMessageToMimirHumanMessage(message: ToolMessage): NextMessageToolResponse {
  return {
    type: "TOOL_RESPONSE",
    toolName: message.name ?? "Unknown",
    toolCallId: message.tool_call_id,
    content: lCmessageContentToContent(message.content)
  };
}

export function toolMessageToToolResponseInfo(message: ToolMessage): ToolResponseInfo {
  const toolResponse = lCmessageContentToContent(message.content);
  return {
    id: message.tool_call_id,
    name: message.name ?? "Unknown",
    response: toolResponse
  };
}


export function aiMessageToMimirAiMessage(aiMessage: AIMessage, files: AiResponseMessage["sharedFiles"]): AiResponseMessage {
  const userContent = getTextAfterUserResponseFromArray(lCmessageContentToContent(aiMessage.content));
  const mimirMessage: AiResponseMessage = {
    content: userContent.result,
    toolCalls: [],
    sharedFiles: files
  };

  if (aiMessage.tool_calls) {
    const tool_calls = aiMessage.tool_calls.map(t => {
      return {
        toolName: t.name,
        input: JSON.stringify(t.args),
        id: t.id
      } satisfies MessageContentToolUse
    });
    mimirMessage.toolCalls = tool_calls;
  }

  return mimirMessage;
}

