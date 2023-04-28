
import { Embeddings } from "langchain/embeddings";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { AIMessageType } from "../schema.js";

export class LongTermMemoryManager {
    private memory: MemoryVectorStore;
    constructor(embeddings: Embeddings) {
        this.memory = new MemoryVectorStore(embeddings)
    }

    async clear() {
        this.memory = new MemoryVectorStore(this.memory.embeddings)
    }

    async storeMessage(userMessage: string, aiResponseMessage: string) {
        await this.memory?.addDocuments([{
            pageContent: `${userMessage} ` + "\nMy Response: " + await this.buildMessageToRemember(aiResponseMessage),
            metadata: {}
        }]);
    }

    async retrieveMessages(message: string, recordsToReturn: number): Promise<string> {
        const memoryResults = await this.memory?.similaritySearch(message, recordsToReturn);
        return memoryResults?.map((result) => result.pageContent).join("\n\n") ?? ""
    }
    private async buildMessageToRemember(messageFromAILog: string) {
        const aiMessage = await JSON.parse(messageFromAILog) as AIMessageType
        const messageToStore = `${aiMessage.thoughts ?? ""} `
            + `${aiMessage.reasoning ?? ""} `
            + `I will use command "${aiMessage.action}" with input "${aiMessage.action_input}"`
        return messageToStore;
    }
}