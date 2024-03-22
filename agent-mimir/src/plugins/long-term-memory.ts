

import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { AgentContext, AgentSystemMessage, MimirAgentPlugin } from "../schema.js";

import { MimirAIMessage } from "../agent/base-agent.js";
import { ResponseFieldMapper } from "../agent/instruction-mapper.js";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { Embeddings } from "@langchain/core/embeddings";
import { extractAllTextFromComplexResponse } from "../utils/format.js";

class LongTermMemoryManager {

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
        return messageFromAILog;
    }
}

export class LongTermMemoryPlugin extends MimirAgentPlugin {

    private longTermMemoryManager: LongTermMemoryManager;

    constructor(embeddings: Embeddings) {
        super()
        this.longTermMemoryManager = new LongTermMemoryManager(embeddings)
    }

    async getSystemMessages(context: AgentContext): Promise<AgentSystemMessage> {
        if (context.input.type === "USER_MESSAGE") {
            const relevantMemory = await this.longTermMemoryManager.retrieveMessages(extractAllTextFromComplexResponse(context.input.content), 3);
            return {
                content: [
                    {
                        type: "text",
                        text: `This reminds you of these events from your past:\n${relevantMemory}`
                    }
                ]
            }
        }
        return {
            content: []
        }
    }


    async readResponse(context: AgentContext, aiMessage: MimirAIMessage, responseFieldMapper: ResponseFieldMapper): Promise<void> {
        if (aiMessage.text && aiMessage.text.length > 0) {
            const messageToStore = context.input.type === "USER_MESSAGE"
                ? ("User Message: " + extractAllTextFromComplexResponse(context.input.content))
                : ("Function Response: " + context.input.jsonPayload);

            await this.longTermMemoryManager?.storeMessage(messageToStore, aiMessage.text);
        }
    }

    async clear() {
        await this.longTermMemoryManager.clear()
    }

}