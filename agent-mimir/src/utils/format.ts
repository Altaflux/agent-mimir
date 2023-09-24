import { BaseMessage, ChatMessage } from "langchain/schema";
import { MimirHumanReplyMessage } from "../schema.js";
import { MimirAIMessage } from "../agent/base-agent.js";

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
      const humanReply = JSON.parse(m.content) as MimirHumanReplyMessage;
      string_messages.push(`${role}: ${humanReply.message}`);
    } else if (m._getType() === "ai") {
      role = aiPrefix;
      let functionInvokationMessage = "";
      const mimirAiMessage = JSON.parse(m.content) as MimirAIMessage;
      if (mimirAiMessage.functionCall) {
        const functionName = mimirAiMessage.functionCall?.name;
        const args = mimirAiMessage.functionCall?.arguments;
        functionInvokationMessage = `I want to call function: ${functionName} with arguments: ${args}`;
      }
    
      string_messages.push(`${role}: ${mimirAiMessage.text}\n ${functionInvokationMessage}`);
    } else if (m._getType() === "system") {
      role = "System";
    } else if (m._getType() === "function") {
      role = humanPrefix;
      const functionReply = JSON.parse(m.content) as MimirHumanReplyMessage;
      string_messages.push(`${role}: The "${functionReply.functionReply?.name}" tool responded the following: ${functionReply.functionReply?.arguments}`);
    } else if (m._getType() === "generic") {
      role = (m as ChatMessage).role;
    } else {
      throw new Error(`Got unsupported message type: ${m}`);
    }
  }
  return string_messages.join("\n");
}
