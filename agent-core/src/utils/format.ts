import { ContentBlock } from "@langchain/core/messages";
import { ComplexMessageContent, TextMessageContent, ImageMessageContent } from "../schema.js";

export function extractTextContent(messageContent: ContentBlock.Standard[]): string {
  if (typeof messageContent === "string") {
    return messageContent;
  } else if (Array.isArray(messageContent)) {
    const text = messageContent
      .filter(c => c.type === 'text')
      .reduce((prev, next) => {
        return prev + (next as ContentBlock.Text).text
      }, "");

    return text;
  } else {
    throw new Error(`Got unsupported text type: ${JSON.stringify(messageContent)}`);
  }
}

export function extractTextContentFromComplexMessageContent(messageContent: ComplexMessageContent[]): string {
  if (typeof messageContent === "string") {
    return messageContent;
  } else if (Array.isArray(messageContent)) {
    return (messageContent as any).find((e: any) => e.type === "text")?.text ?? "";
  } else {
    throw new Error(`Got unsupported text type: ${JSON.stringify(messageContent)}`);
  }
}


export function complexResponseToLangchainMessageContent(toolResponse: ComplexMessageContent[]): Array<ContentBlock.Standard> {
  const content = toolResponse.map((en) => {
    if (en.type === "text") {
      return {
        type: "text",
        text: en.text
      } satisfies ContentBlock.Text
    } else if (en.type === "image") {
      return openAIImageHandler(en, "high")
    }
    throw new Error(`Unsupported type: ${JSON.stringify(en)}`)
  }).filter(c => !(c.type === "text" && c.text === ""))
  return content
}

export function extractAllTextFromComplexResponse(toolResponse: ComplexMessageContent[]): string {
  return toolResponse.filter((r) => r.type === "text").map((r) => (r as TextMessageContent).text).join("\n");
}

export const openAIImageHandler = (image: ImageMessageContent, detail: "high" | "low" = "high"): ContentBlock.Multimodal.Image => {
  return {
    type: "image",
    mimeType: image.mimeType,
    data: image.data,
  } as ContentBlock.Multimodal.Image;
}

export function trimAndSanitizeMessageContent(inputArray: ComplexMessageContent[]): ComplexMessageContent[] {
  return inputArray.filter((c) => {
    const isEmpty = (c.type === "text" && c.text.length === 0);
    return !isEmpty;
  })
}


export function isEmptyMessageContent(message: ComplexMessageContent): boolean {
  if (message.type === "text") {
    return message.text.trim().length === 0;
  } else if (message.type === "image") {
    return false; // Images are not considered empty
  } else {
    return false
  }
}


export function textComplexMessage(text: string): TextMessageContent {
  return {
    type: "text",
    text: text
  } satisfies TextMessageContent
}
