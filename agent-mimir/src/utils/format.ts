import { MessageContent, MessageContentComplex, MessageContentText } from "@langchain/core/messages";
import { ComplexMessageContent, TextMessageContent, SupportedImageTypes } from "../schema.js";

export function extractTextContent(messageContent: MessageContent): string {
  if (typeof messageContent === "string") {
    return messageContent;
  } else if (Array.isArray(messageContent)) {
    return (messageContent as any).find((e: any) => e.type === "text")?.text ?? "";
  } else {
    throw new Error(`Got unsupported text type: ${JSON.stringify(messageContent)}`);
  }
}


export function complexResponseToLangchainMessageContent(toolResponse: ComplexMessageContent[]): MessageContentComplex[] {
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


export function extractAllTextFromComplexResponse(toolResponse: ComplexMessageContent[]): string {
  return toolResponse.filter((r) => r.type === "text").map((r) => (r as TextMessageContent).text).join("\n");
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

export function trimAndSanitizeMessageContent(inputArray: ComplexMessageContent[]): ComplexMessageContent[] {
  return inputArray.filter((c) => {
    const isEmpty = (c.type === "text" && c.text.length === 0);
    return !isEmpty;
  })
}


