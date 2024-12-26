import { AIMessage, BaseMessage, MessageContent, MessageContentComplex, MessageContentText } from "@langchain/core/messages";
import { ComplexResponse, ImageType, MessageContentToolUse, MimirAiMessage, ResponseContentText } from "../schema.js";


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

export function aiMessageToMimirAiMessage(aiMessage: AIMessage): MimirAiMessage {
  const content = aiMessage.content;
  const mimirMessage = {
    content: [],
    toolCalls: []
  } as MimirAiMessage;
  if (typeof content === 'string' || content instanceof String) {
    mimirMessage.content.push({
      type: "text",
      text: content as string
    })
  } else {
    let cont = content.map(c => {
      if (c.type === "text") {
        return {
          type: "text" as const,
          text: c.text
        }
      } else {
        return null;
      }
    }).filter(e => e !== null).map(e => e!);
    mimirMessage.content = cont;
  }

  if (aiMessage.tool_calls) {
    const tool_calls = aiMessage.tool_calls.map(t => {
      return {
        name: t.name,
        input: t.args,
        id: t.id
      } satisfies MessageContentToolUse
    });
    mimirMessage.toolCalls = tool_calls;
  }

  return mimirMessage;
}

export function extractAllTextFromComplexResponse(toolResponse: ComplexResponse[]) {
  return toolResponse.filter((r) => r.type === "text").map((r) => (r as ResponseContentText).text).join("\n");
}

export const openAIImageHandler = (image: ImageType, detail: "high" | "low" = "high") => {
  return {
    type: "image_url" as const,
    image_url: {
      url: image.type === "url" ? image.url : `data:image/${image.type};base64,${image.url}`,
      detail: detail
    }
  }
}
