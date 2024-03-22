import { BaseMessage, MessageContent, MessageContentComplex, MessageContentText } from "@langchain/core/messages";
import { ComplexResponse, LLMImageHandler, ResponseContentText } from "../schema.js";

export function messagesToString(
  messages: BaseMessage[],
  humanPrefix = "Human",
  aiPrefix = "AI"
): string {
  const string_messages: string[] = [];
  for (const m of messages) {
    let role: string;
    if (m._getType() === "human") {
      role = humanPrefix;
      const mm = `Start-Of-Message:\n- Participant: ${role}\n- Task: message\n- Payload: ${extractTextContent(m.content)}`
      string_messages.push(mm);
    } else if (m._getType() === "ai") {
      role = aiPrefix;
      const functionName = m.additional_kwargs.function_call?.name ?? "message";
      const arg = m.additional_kwargs.function_call?.arguments ?? extractTextContent(m.content);
      const mm = `Start-Of-Message:\n- Participant: ${role}\n- Task: ${functionName}\n- Payload: ${arg}`
      string_messages.push(mm);
    } else if (m._getType() === "system") {
      role = humanPrefix;
      string_messages.push(`${role}: ${extractTextContent(m.content)}`);
    } else if (m._getType() === "function") {
      role = humanPrefix;
      const mm = `Start-Of-Message:\n- Participant: ${role}\n- Task: message\n- Payload: The "${m.name}" tool responded the following: ${extractTextContent(m.content)}`
      string_messages.push(mm);
    } else if (m._getType() === "generic") {
      role = humanPrefix;
      string_messages.push(`${role}: ${extractTextContent(m.content)}`);
    } else {
      throw new Error(`Got unsupported message type: ${m}`);
    }
  }
  return string_messages.join("\n\n\n");
}

export function extractTextContent(messageContent: MessageContent) {
  if (typeof messageContent === "string") {
    return messageContent;
  } else if (Array.isArray(messageContent)) {
    return (messageContent as any).find((e: any) => e.type === "text")?.text ?? "";
  } else {
    throw new Error(`Got unsupported text type: ${JSON.stringify(messageContent)}`);
  }
}


export function complexResponseToLangchainMessageContent(toolResponse: ComplexResponse[], imageHandler: LLMImageHandler): MessageContentComplex[] {
  return toolResponse.map((en) => {
    if (en.type === "text") {
      return {
        type: "text",
        text: en.text
      } satisfies MessageContentText
    } else if (en.type === "image_url") {
      return imageHandler(en.image_url, "high")
    }
    throw new Error(`Unsupported type: ${JSON.stringify(en)}`)
  })
}

export function extractAllTextFromComplexResponse(toolResponse: ComplexResponse[]) {
  return toolResponse.filter((r) => r.type === "text").map((r)=> (r as ResponseContentText).text).join("\n");
}