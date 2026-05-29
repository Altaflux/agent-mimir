import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { AiResponseMessage, NextMessagePluginNotification, NextMessageToolResponse, NextMessageUser } from "../../plugins/index.js";
import { getHumanMessageSharedFiles, lCmessageContentToContent, readRuntimeInputKind, readRuntimeNotification } from "../message-utils.js";
import {  MessageContentToolUse, ToolResponseInfo } from "../index.js";
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

export function langChainHumanMessageToMimirHumanMessage(message: HumanMessage): NextMessageUser | NextMessagePluginNotification {
  const base = {
    sharedFiles: getHumanMessageSharedFiles(message),
    content: lCmessageContentToContent(message.contentBlocks)
  };
  const inputKind = readRuntimeInputKind(message);
  const notification = readRuntimeNotification(message);
  if (inputKind === "plugin_notification" && notification) {
    return {
      type: "PLUGIN_NOTIFICATION",
      ...notification,
      ...base
    };
  }

  return {
    type: "USER_MESSAGE",
    ...base
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

