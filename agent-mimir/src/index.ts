import { SystemChatMessage } from 'langchain/schema'
import { AttributeDescriptor, ResponseFieldMapper } from './agent/instruction-mapper.js'
import { MimirAIMessage } from './agent/base-agent.js'
import { StructuredTool } from 'langchain/tools'
import { SystemMessagePromptTemplate } from 'langchain/prompts'


export * from './schema.js'

export { SteppedAgentExecutor } from './executor/index.js'

export { MimirChatConversationalAgent } from './agent/index.js'
// export { Gpt4FunctionAgent } from './agent/function/index.js'
export { AgentManager } from './agent-manager/index.js'


export abstract class MimirAgentPlugin {

    systemMessages(): SystemMessagePromptTemplate[] {
        return [];
    }

    async readResponse(aiMessage: MimirAIMessage, responseFieldMapper: ResponseFieldMapper): Promise<void> {
    }

    async clear(): Promise<void> {
    }

    async getInputs(): Promise<Record<string, any>> {
        return {};
    }

    attributes():AttributeDescriptor[] {
        return [];
    }

    tools(): StructuredTool[] {
        return [];
    }
}

export class LangchainToolWrapper extends MimirAgentPlugin {
    constructor(private tool: StructuredTool) {
        super();
    }

    tools(): StructuredTool[] {
        return [this.tool];
    }
}
