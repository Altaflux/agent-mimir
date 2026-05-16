import { ComplexMessageContent } from "@mimir/agent-core/schema";
import { AgentTool } from "@mimir/agent-core/tools";

export interface MouseMode {
    init(): Promise<void>;
    reset(): Promise<void>;
    destroy(): Promise<void>;

    getScreenshot(): Promise<{ content: ComplexMessageContent[], finalImage: Buffer }>;

    getTools(): Promise<(AgentTool)[]>;

    instructionsMessage(): string;
}
