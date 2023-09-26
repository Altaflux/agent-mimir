import { BaseMessage, ChatMessage } from "langchain/schema";

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
      string_messages.push(`${role}: ${m.content}`);
    } else if (m._getType() === "ai") {
      role = aiPrefix;
      let functionInvokationMessage = "";
      if (m.additional_kwargs?.function_call){
        const functionName = m.additional_kwargs.function_call?.name;
        const args = m.additional_kwargs.function_call?.arguments;
        functionInvokationMessage = `I want to call function: ${functionName} with arguments: ${args}`;
      }
      string_messages.push(`${role}: ${m.content}\n ${functionInvokationMessage}`);
    } else if (m._getType() === "system") {
      role = humanPrefix;
      string_messages.push(`${role}: ${m.content}`);
    } else if (m._getType() === "function") {
      role = humanPrefix;
      string_messages.push(`${role}: The "${m.name}" tool responded the following: ${m.content}`);
    } else if (m._getType() === "generic") {
      role = humanPrefix;
      string_messages.push(`${role}: ${m.content}`);
    } else {
      throw new Error(`Got unsupported message type: ${m}`);
    }
  }
  return string_messages.join("\n");
}
