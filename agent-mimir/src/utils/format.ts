import { AIMessage, BaseMessage, ChatMessage, FunctionMessage, HumanMessage, StoredMessage, SystemMessage } from "langchain/schema";
import { MimirHumanReplyMessage } from "../schema.js";
import { MimirAIMessage } from "../agent/base-agent.js";

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

  export function getBufferStringOrig(
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
      string_messages.push(`${role}: ${nameStr} ${m.content}`);
    }
    return string_messages.join("\n");
  }

  export function formatForCompaction(
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
        if (m.additional_kwargs?.function_call){
          const functionName = m.additional_kwargs?.function_call.name;
          const args = m.additional_kwargs?.function_call.arguments;
          functionInvokationMessage = `I want to call function: ${functionName} with arguments: ${args}`;
        }
        const mimirAiMessage = JSON.parse(m.content) as MimirAIMessage;
        string_messages.push(`${role}: ${mimirAiMessage.text}\n ${functionInvokationMessage}`);
      } else if (m._getType() === "system") {
        role = "System";
      } else if (m._getType() === "function") {
        role = humanPrefix;
        string_messages.push(`${role}: The tool responded the following = ${JSON.parse(m.content).data?.content}`);
      } else if (m._getType() === "generic") {
        role = (m as ChatMessage).role;
      } else {
        throw new Error(`Got unsupported message type: ${m}`);
      }
    }
    return string_messages.join("\n");
  }


  // const generation = generations[0] as ChatGeneration;
  // const functionCall: any = generation.message?.additional_kwargs?.function_call
  // const mimirMessage = {
  //     functionCall: functionCall ? {
  //         name: functionCall?.name,
  //         arguments: (functionCall?.arguments),
  //     } : undefined,
  //     text: generation.text,
  // }
  // return mimirMessage;