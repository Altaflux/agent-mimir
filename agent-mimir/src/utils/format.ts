import { AIMessage, BaseMessage, ChatMessage, FunctionMessage, HumanMessage, StoredMessage, SystemMessage } from "langchain/schema";

export function createBulletedList(arr: string[]) {
    let listString = '';
    for (let i = 0; i < arr.length; i++) {
        listString += '• ' + arr[i] + '\n';
    }
    return listString;
}


export function mapStoredMessagesToChatMessages(
    messages: StoredMessage[]
): BaseMessage[] {
    return messages.map((message) => {
        const storedMessage = message;
        switch (storedMessage.type) {
            case "human":
                return new HumanMessage(storedMessage.data.content);
            case "ai":
                return new AIMessage(
                    storedMessage.data.content,
                    storedMessage.data.additional_kwargs
                );
            case "function":
                return new FunctionMessage(storedMessage.data.content, storedMessage.data.name!);
            case "system":
                return new SystemMessage(storedMessage.data.content);
            case "chat":
                if (storedMessage.data?.additional_kwargs?.role === undefined) {
                    throw new Error("Role must be defined for chat messages");
                }
                return new ChatMessage(
                    storedMessage.data.content,
                    storedMessage.data.additional_kwargs.role
                );
            default:
                throw new Error(`Got unexpected type: ${storedMessage.type}`);
        }
    });
}

export function getBufferString2(
    messages: BaseMessage[],
    humanPrefix = "Human",
    aiPrefix = "AI"
  ): string {
    const string_messages: string[] = [];
    for (const m of messages) {
      let role: string;
      if (m._getType() === "human") {
        role = humanPrefix;
      } else if (m._getType() === "ai") {
        role = aiPrefix;
      } else if (m._getType() === "system") {
        role = "System";
      } else if (m._getType() === "function") {
        role = "Function";
      } else if (m._getType() === "generic") {
        role = (m as ChatMessage).role;
      } else {
        throw new Error(`Got unsupported message type: ${m}`);
      }
      const nameStr = m.name ? `${m.name}, ` : "";
      try {
        string_messages.push(`${role}: ${nameStr}${JSON.parse(m.content).data?.content}`);
      }catch(e){
     //   console.log(e);
        string_messages.push(`${role}: ${nameStr} ${m.content}`);
      }
    }
    return string_messages.join("\n");
  }