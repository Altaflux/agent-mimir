import { Agent, AgentResponse, AgentMessageToolRequest, AgentUserMessageResponse, ToolResponseInfo, AgentMessage } from "../agent-manager/index.js";
import { ComplexResponse } from "../schema.js";


type PendingMessage = {
    responseAttributes: Record<string, any>,
    content: ComplexResponse[];
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
    content: ComplexResponse[],
    responseAttributes: Record<string, any>
}
export type HandleMessageResult = ({
    type: "agentResponse",

} & AgentUserMessage) | {
    type: "toolRequest",
} & AgentToolRequestTwo;

export type AgentToolRequestTwo = AgentMessageToolRequest & {
    callingAgent: string,
}

export type AgentUserMessage = {
    content: ComplexResponse[],
    responseAttributes: Record<string, any>
}
export class MultiAgentCommunicationOrchestrator {
    private currentAgent: Agent;
    private agentStack: Agent[] = [];

    constructor(private readonly agentManager: ReadonlyMap<string, Agent>, currentAgent: Agent) {
        this.currentAgent = currentAgent;
    }

    async* handleMessage(msg: AgentInvoke): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {

        const handleMessage = async (chainResponse: AgentUserMessageResponse, agentStack: Agent[]): Promise<{
            conversationComplete: boolean,
            currentAgent: Agent,
            pendingMessage: PendingMessage | undefined
        }> => {
            if (chainResponse.output.destinationAgent) {
                const newAgent = this.agentManager.get(chainResponse.output.destinationAgent);
                if (!newAgent) {
                    return {
                        conversationComplete: false,
                        currentAgent: this.currentAgent,
                        pendingMessage: {
                            content: [
                                { type: "text", text: `Agent ${chainResponse.output.destinationAgent} does not exist.` }
                            ],
                            responseAttributes: {}
                        }
                    }
                }
                agentStack.push(this.currentAgent);
                return {
                    conversationComplete: false,
                    currentAgent: newAgent,
                    pendingMessage: {
                        content: chainResponse.output.content,
                        responseAttributes: chainResponse.responseAttributes
                    }
                }
            } else {
                const isFinalUser = agentStack.length === 0;
                return {
                    conversationComplete: isFinalUser,
                    currentAgent: isFinalUser ? this.currentAgent : agentStack.pop()!,
                    pendingMessage: {
                        content: chainResponse.output.content,
                        responseAttributes: chainResponse.responseAttributes
                    }
                }
            }
        }
        let pendingMessage: PendingMessage | undefined = undefined;
        while (true) {

            let generator = pendingMessage
                ? this.currentAgent.call(pendingMessage.content, pendingMessage.responseAttributes, true)
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
                        content: chainResponse.output.content,
                        responseAttributes: chainResponse.responseAttributes
                    };
                } else {
                    pendingMessage = routedMessage.pendingMessage;
                    yield {
                        type: "agentToAgentMessage",
                        sourceAgent: sourceAgent!,
                        destinationAgent: this.currentAgent.name,
                        content: chainResponse.output.content,
                        responseAttributes: chainResponse.responseAttributes
                    }
                }
            } else {
                return {
                    type: "toolRequest",
                    callingAgent: this.currentAgent.name,
                    content: chainResponse.output.content,
                    toolCalls: chainResponse.output.toolCalls,
                }
            }
        }
    }
}