import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { AiResponseMessage, NextMessageToolResponse, NextMessageUser } from "../../plugins/index.js";
import { lCmessageContentToContent } from "../message-utils.js";
import {  MessageContentToolUse, SharedFile, ToolResponseInfo } from "../index.js";
import { ResponseFieldMapper } from "../../utils/instruction-mapper.js";
import { v4 } from "uuid";

export function langChainToolMessageToMimirToolMessage(message: ToolMessage): NextMessageToolResponse {
  return {
    type: "TOOL_RESPONSE",
    toolName: message.name ?? "Unknown",
    toolCallId: message.tool_call_id,
    content: lCmessageContentToContent(message.contentBlocks)
  };
}

export function langChainHumanMessageToMimirHumanMessage(message: HumanMessage): NextMessageUser {
  return {
    type: "USER_MESSAGE",
    sharedFiles: [
      ...(message.additional_kwargs?.["sharedFiles"] as SharedFile[] ?? [])
    ],
    content: lCmessageContentToContent(message.contentBlocks)
  };
}

export function aiMessageToMimirAiMessage(aiMessage: AIMessage, files: AiResponseMessage["sharedFiles"], mapper: ResponseFieldMapper): AiResponseMessage {
  const userContent = mapper.getUserMessage(lCmessageContentToContent(aiMessage.contentBlocks));
  const mimirMessage: AiResponseMessage = {
    id: aiMessage.id ?? v4(),
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

