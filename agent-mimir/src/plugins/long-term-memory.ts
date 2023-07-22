
import { Embeddings } from "langchain/embeddings";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { AgentContext, MimirAgentPlugin } from "../schema.js";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { MimirAIMessage } from "../agent/base-agent.js";
import { ResponseFieldMapper } from "../agent/instruction-mapper.js";

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

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate("This reminds you of these events from your past:\n{relevantMemory}"),
        ];
    }

    async readResponse(context: AgentContext, aiMessage: MimirAIMessage, responseFieldMapper: ResponseFieldMapper): Promise<void> {
        if (aiMessage.text && aiMessage.text.length > 0) {
            const messageToStore = context.input.type === "USER_MESSAGE"
                ? ("User Message: " + context.input.message)
                : ("Function Response: " + context.input.message);

            await this.longTermMemoryManager?.storeMessage(messageToStore, aiMessage.text);
        }
    }

    async getInputs(context: AgentContext): Promise<Record<string, any>> {

        return {
            relevantMemory: await this.longTermMemoryManager.retrieveMessages(context.input.message, 3)
        };
    }

    async clear() {
        await this.longTermMemoryManager.clear()
    }

}