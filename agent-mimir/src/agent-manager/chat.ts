import { Agent, AgentResponse, AgentToolRequest as InternalAgentToolRequest,  AgentUserMessageResponse, ToolResponseInfo } from "../schema.js";
import { AgentManager } from "./index.js";


type PendingMessage = {
    responseAttributes:Record<string, any>,
    message: string;
}
export type AgentInvoke = (agent: Agent,) => AsyncGenerator<ToolResponseInfo, AgentResponse, unknown>;

type AgentToAgentMessage = {
    agentName: string,
    message: string, 
    responseAttributes:Record<string, any>
}

export type AgentToolRequest = InternalAgentToolRequest & {
    agentName: string,
}

export type AgentUserMessage = {
    message: string,
    responseAttributes:Record<string, any>
}
export class AgentHandle {
    private currentAgent: Agent;
    private pendingMessage: PendingMessage | undefined = undefined;
    private agentStack: Agent[] = [];

    constructor(private readonly agentManager: AgentManager, currentAgent: Agent) {
        this.currentAgent = currentAgent;
    }

    async* handleMessage(msg: AgentInvoke): AsyncGenerator<ToolResponseInfo | AgentToAgentMessage, AgentUserMessage | AgentToolRequest, void> {

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
        //////////

        while (true) {
            let generator = this.pendingMessage
                ? this.currentAgent.call(this.pendingMessage.message, this.pendingMessage.responseAttributes)
                : msg(this.currentAgent);


            let result: IteratorResult<ToolResponseInfo, AgentResponse>;
            while (!(result = await generator.next()).done) {
                //toolCallback(result.value)
                yield result.value;
            }
            let chainResponse = result.value


            if (chainResponse.type == "agentResponse") {
                //await messageSender(chainResponse);
                const routedMessage = await handleMessage(chainResponse, this.agentStack);
                this.currentAgent = routedMessage.currentAgent;
                this.pendingMessage = routedMessage.pendingMessage;
                if (routedMessage.conversationComplete) {
                    return {
                        //agentName: chainResponse.output.agentName!,
                        message: chainResponse.output.message,
                        responseAttributes: chainResponse.responseAttributes
                    };
                } else {
                    //Message to another agent.
                    yield {
                        agentName: chainResponse.output.agentName!,
                        message: chainResponse.output.message,
                        responseAttributes: chainResponse.responseAttributes
                    }
                }
            }
        }
    }
}