import { Agent, AgentResponse, AgentToolRequest as InternalAgentToolRequest, AgentUserMessageResponse, ToolResponseInfo } from "../schema.js";
import { AgentManager } from "./index.js";


type PendingMessage = {
    responseAttributes: Record<string, any>,
    message: string;
}
export type AgentInvoke = (agent: Agent,) => AsyncGenerator<ToolResponseInfo, AgentResponse, unknown>;


export type IntermediateAgentResponse = ({
    type: "agentToAgentMessage",
} & AgentToAgentMessage) | {
    type: "toolResponse",
    agentName: string,
} & ToolResponseInfo;
export type AgentToAgentMessage = {
    sourceAgent: string,
    destinationAgent: string,
    message: string,
    responseAttributes: Record<string, any>
}
export type HandleMessageResult = ({
    type: "agentResponse",

} & AgentUserMessage) | {
    type: "toolRequest",
} & AgentToolRequest;

export type AgentToolRequest = InternalAgentToolRequest & {
    agentName: string,
}

export type AgentUserMessage = {
    message: string,
    responseAttributes: Record<string, any>
}
export class AgentHandle {
    private currentAgent: Agent;
    private agentStack: Agent[] = [];

    constructor(private readonly agentManager: AgentManager, currentAgent: Agent) {
        this.currentAgent = currentAgent;
    }

    async* handleMessage(msg: AgentInvoke): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {

        const handleMessage = async (chainResponse: AgentUserMessageResponse, agentStack: Agent[]): Promise<{
            conversationComplete: boolean,
            currentAgent: Agent,
            pendingMessage: PendingMessage | undefined
        }> => {
            if (chainResponse.output.agentName) {
                const newAgent = this.agentManager.getAgent(chainResponse.output.agentName);
                if (!newAgent) {
                    return {
                        conversationComplete: false,
                        currentAgent: this.currentAgent,
                        pendingMessage: {
                            message: "No agent found with that name.",
                            responseAttributes: {}
                        }
                    }
                }
                agentStack.push(this.currentAgent);
                return {
                    conversationComplete: false,
                    currentAgent: newAgent,
                    pendingMessage: {
                        message: chainResponse.output.message,
                        responseAttributes: chainResponse.responseAttributes
                    }
                }
            } else {
                const isFinalUser = agentStack.length === 0;
                return {
                    conversationComplete: isFinalUser,
                    currentAgent: isFinalUser ? this.currentAgent : agentStack.pop()!,
                    pendingMessage: {
                        message: chainResponse.output.message,
                        responseAttributes: chainResponse.responseAttributes
                    }
                }
            }
        }
        let pendingMessage: PendingMessage | undefined = undefined;
        while (true) {

            let generator = pendingMessage
                ? this.currentAgent.call(pendingMessage.message, pendingMessage.responseAttributes, true)
                : msg(this.currentAgent);


            let result: IteratorResult<ToolResponseInfo, AgentResponse>;
            while (!(result = await generator.next()).done) {
                yield {
                    type: "toolResponse",
                    agentName: this.currentAgent.name,
                    ...result.value
                };
            }
            let chainResponse = result.value


            if (chainResponse.type == "agentResponse") {
                const sourceAgent = this.currentAgent.name;
                const routedMessage = await handleMessage(chainResponse, this.agentStack);
                this.currentAgent = routedMessage.currentAgent;
                if (routedMessage.conversationComplete) {
                    return {
                        type: "agentResponse",
                        message: chainResponse.output.message,
                        responseAttributes: chainResponse.responseAttributes
                    };
                } else {
                    pendingMessage = routedMessage.pendingMessage;
                    yield {
                        type: "agentToAgentMessage",
                        sourceAgent: sourceAgent!,
                        destinationAgent: this.currentAgent.name,
                        message: chainResponse.output.message,
                        responseAttributes: chainResponse.responseAttributes
                    }
                }
            } else {
                return {
                    type: "toolRequest",
                    agentName: this.currentAgent.name,
                    message: chainResponse.output.message,
                    toolRequests: chainResponse.output.toolRequests,
                }
            }
        }
    }
}