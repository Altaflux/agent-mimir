import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { AiResponseMessage, NextMessageToolResponse } from "../../plugins/index.js";
import { lCmessageContentToContent } from "../message-utils.js";
import { AgentMessageToolRequest, MessageContentToolUse, ToolResponseInfo } from "../index.js";
import { ComplexMessageContent } from "../../schema.js";

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


export function aiMessageToMimirAiMessage(aiMessage: AIMessage, content: ComplexMessageContent[], files: AiResponseMessage["sharedFiles"]): AiResponseMessage {
  
    const mimirMessage = {
      content: content,
      toolCalls: [],
      sharedFiles: files
    } as AiResponseMessage;
   
    if (aiMessage.tool_calls) {
      const tool_calls = aiMessage.tool_calls.map(t => {
        return {
          toolName: t.name,
          input: t.args,
          id: t.id
        } satisfies MessageContentToolUse
      });
      mimirMessage.toolCalls = tool_calls;
    }
  
    return mimirMessage;
  }
  
export function parseToolMessage(aiMessage: AIMessage, responseAttributes: Record<string, any>): AgentMessageToolRequest {
    const content = lCmessageContentToContent(aiMessage.content);
    return {
        toolCalls: (aiMessage.tool_calls ?? []).map(t => ({
            id: t.id,
            toolName: t.name,
            input: t.args
        })),
        content: content
    };
}