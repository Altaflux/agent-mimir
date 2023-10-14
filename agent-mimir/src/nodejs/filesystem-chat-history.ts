import { AIMessage, BaseListChatMessageHistory, BaseMessage, ChatMessage, ChatMessageFieldsWithRole, FunctionMessage, HumanMessage, StoredMessage, SystemMessage } from "langchain/schema";
import { promises as fs } from 'fs';
import path from "path";
export class FileSystemChatHistory extends BaseListChatMessageHistory {

  constructor(private path: string) {
    super();
  }

  async getMessages(): Promise<BaseMessage[]> {
    await this.init();
    const content = await fs.readFile(this.path, 'utf-8')
    const storedMessages: StoredMessage[] = JSON.parse(content) as StoredMessage[];
    const messageChat = mapStoredMessagesToChatMessages(storedMessages);
    return messageChat;
  }
  
  async addMessage(message: BaseMessage): Promise<void> {
    await this.init();
    const content = await fs.readFile(this.path, 'utf-8')
    const storedMessages: StoredMessage[] = JSON.parse(content) as StoredMessage[];
    storedMessages.push(message.toDict());
    await fs.writeFile(this.path, JSON.stringify(storedMessages));   
  }

  async addUserMessage(message: string): Promise<void> {
    await this.addMessage(new HumanMessage(message));
  }

  async addAIChatMessage(message: string): Promise<void> {
    await this.addMessage(new AIMessage(message));
  }

  async clear(): Promise<void> {
    await fs.writeFile(this.path, JSON.stringify([]));
  }

  private async init(): Promise<void> {
    const fileExists = await fs.access(this.path, fs.constants.F_OK).then(() => true).catch(() => false);
    if (!fileExists) {
      const directory = path.dirname(this.path);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(this.path, JSON.stringify([]));
    }
  }
  lc_namespace: string[] = [];

}


export function mapStoredMessagesToChatMessages(
  messages: StoredMessage[]
): BaseMessage[] {
  return messages.map((message) => {
    const storedMessage = (message);
    switch (storedMessage.type) {
      case "human":
        return new HumanMessage(storedMessage.data);
      case "ai":
        return new AIMessage(storedMessage.data);
      case "system":
        return new SystemMessage(storedMessage.data);
      case "function":
        if (storedMessage.data.name === undefined) {
          throw new Error("Name must be defined for function messages");
        }
        return new FunctionMessage(
          storedMessage.data as any,
          storedMessage.data.name
        );
      case "chat": {
        if (storedMessage.data.role === undefined) {
          throw new Error("Role must be defined for chat messages");
        }
        return new ChatMessage(storedMessage.data as ChatMessageFieldsWithRole);
      }
      default:
        throw new Error(`Got unexpected type: ${storedMessage.type}`);
    }
  });
}

export function mapChatMessagesToStoredMessages(
  messages: BaseMessage[]
): StoredMessage[] {
  return messages.map((message) => message.toDict());
}
