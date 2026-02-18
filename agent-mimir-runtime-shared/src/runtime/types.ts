import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { Embeddings } from "@langchain/core/embeddings";
import { StructuredTool } from "@langchain/core/tools";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { PluginFactory } from "agent-mimir/plugins";

export type AgentDefinition = {
    mainAgent?: boolean;
    description: string;
    definition?: {
        profession: string;
        chatModel: BaseChatModel;
        taskModel?: BaseLanguageModel;
        constitution?: string;
        visionSupport?: "openai";
        plugins?: PluginFactory[];
        chatHistory?: {
            summaryModel?: BaseChatModel;
            tokenLimit?: number;
            conversationTokenThreshold?: number;
        };
        langChainTools?: StructuredTool[];
        communicationWhitelist?: string[] | boolean;
    };
};

export type AgentMimirConfig = {
    agents: Record<string, AgentDefinition>;
    checkpointer?: BaseCheckpointSaver;
    embeddings: Embeddings;
    continuousMode?: boolean;
    workingDirectory?: string;
};
