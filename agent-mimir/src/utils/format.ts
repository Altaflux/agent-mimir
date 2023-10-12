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
      const mm = `Start-Of-Message:\n- Participant: ${role}\n- Task: message\n- Payload: ${m.content}`
      string_messages.push(mm);
    } else if (m._getType() === "ai") {
      role = aiPrefix;
      const functionName = m.additional_kwargs.function_call?.name ?? "message";
      const arg = m.additional_kwargs.function_call?.arguments ?? m.content;
      const mm = `Start-Of-Message:\n- Participant: ${role}\n- Task: ${functionName}\n- Payload: ${arg}`
      string_messages.push(mm);
    } else if (m._getType() === "system") {
      role = humanPrefix;
      string_messages.push(`${role}: ${m.content}`);
    } else if (m._getType() === "function") {
      role = humanPrefix;
      const mm = `Start-Of-Message:\n- Participant: ${role}\n- Task: message\n- Payload: The "${m.name}" tool responded the following: ${m.content}`
      string_messages.push(mm);
    } else if (m._getType() === "generic") {
      role = humanPrefix;
      string_messages.push(`${role}: ${m.content}`);
    } else {
      throw new Error(`Got unsupported message type: ${m}`);
    }
  }
  return string_messages.join("\n\n\n");
}
