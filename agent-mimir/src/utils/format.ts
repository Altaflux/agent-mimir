import { MessageContent, MessageContentComplex, MessageContentText } from "@langchain/core/messages";
import { ComplexMessageContent, TextMessageContent, SupportedImageTypes } from "../schema.js";
import { USER_RESPONSE } from "./instruction-mapper.js";


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




export function getTextAfterUserResponseFromArray(inputArray: ComplexMessageContent[]): { tagFound: boolean, result: ComplexMessageContent[] } {
  // Validate input: Ensure it's an array
  if (!Array.isArray(inputArray)) {
    console.error("Input must be an array.");
    return { tagFound: false, result: [] }; // Return empty array for invalid input
  }

  const marker = USER_RESPONSE; // Note: Using the exact marker from your example
  let markerFoundAtIndex = -1;
  let result: ComplexMessageContent[] = [];

  // Find the index of the first element containing the marker
  for (let i = 0; i < inputArray.length; i++) {
    const entry = inputArray[i];
    // Make sure the element is a string before calling indexOf
    if (entry.type === "text" && entry.text.includes(marker)) {
      markerFoundAtIndex = i;
      break; // Stop searching once the first occurrence is found
    }
  }

  // If the marker was not found in any element
  if (markerFoundAtIndex === -1) {
    return { tagFound: false, result: inputArray }; // Return the original array if marker not found
  }

  // --- Marker was found ---

  // Get the string where the marker was found
  const stringContainingMarker = (inputArray[markerFoundAtIndex] as TextMessageContent);

  // Find the position *within* that string where the marker ends
  const markerIndexInString = (stringContainingMarker as TextMessageContent).text.indexOf(marker);
  const startIndex = markerIndexInString + marker.length;

  // Extract the part of the string after the marker
  // Use trim() to remove leading/trailing whitespace
  const extractedPart = {
    type: "text" as const,
    text: stringContainingMarker.text.slice(startIndex).trim()
  };

  // Add the extracted part as the first element of the result
  result.push(extractedPart);

  // Add all subsequent elements from the original array (if any)
  // Slice the original array starting from the index *after* the one where the marker was found
  const remainingElements = inputArray.slice(markerFoundAtIndex + 1);
  result = result.concat(remainingElements); // Combine the extracted part with the rest

  /* Alternative using spread syntax:
  const remainingElements = inputArray.slice(markerFoundAtIndex + 1);
  result = [extractedPart, ...remainingElements];
  */

  return { tagFound: true, result: result }; // Return the result array with the extracted part
}

