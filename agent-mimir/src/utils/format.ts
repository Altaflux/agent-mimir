import { AIMessage, MessageContent, MessageContentComplex, MessageContentText } from "@langchain/core/messages";
import { ComplexResponse,   ResponseContentText, SupportedImageTypes } from "../schema.js";
import { MessageContentToolUse } from "../agent-manager/index.js";
import { AiResponseMessage } from "../plugins/index.js";


export function extractTextContent(messageContent: MessageContent) {
  if (typeof messageContent === "string") {
    return messageContent;
  } else if (Array.isArray(messageContent)) {
    return (messageContent as any).find((e: any) => e.type === "text")?.text ?? "";
  } else {
    throw new Error(`Got unsupported text type: ${JSON.stringify(messageContent)}`);
  }
}


export function complexResponseToLangchainMessageContent(toolResponse: ComplexResponse[]): MessageContentComplex[] {
  return toolResponse.map((en) => {
    if (en.type === "text") {
      return {
        type: "text",
        text: en.text
      } satisfies MessageContentText
    } else if (en.type === "image_url") {
      return openAIImageHandler(en.image_url, "high")
    }
    throw new Error(`Unsupported type: ${JSON.stringify(en)}`)
  })
}

export function aiMessageToMimirAiMessage(aiMessage: AIMessage, content: ComplexResponse[], files: AiResponseMessage["sharedFiles"]): AiResponseMessage {
  
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

export function extractAllTextFromComplexResponse(toolResponse: ComplexResponse[]): string {
  return toolResponse.filter((r) => r.type === "text").map((r) => (r as ResponseContentText).text).join("\n");
}

export const openAIImageHandler = (image: { url: string, type: SupportedImageTypes }, detail: "high" | "low" = "high") => {
  let type = image.type as string;
  if (type === "jpg") {
    type = "jpeg"
  }
  const res = {
    type: "image_url" as const,
    image_url: {
      url: image.type === "url" ? image.url : `data:image/${type};base64,${image.url}`,
      detail: detail
    }
  }
  return res;
}
