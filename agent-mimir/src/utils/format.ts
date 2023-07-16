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
