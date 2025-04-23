import { Agent, AgentResponse, AgentMessageToolRequest, AgentUserMessageResponse, ToolResponseInfo, InputAgentMessage, AgentFactory } from "../agent-manager/index.js";
import { HelpersPluginFactory } from "./helpers.js";
import { PluginFactory } from "../plugins/index.js";

type PendingMessage = {
    content: InputAgentMessage;
    threadId: string,
    replyFromAgent: string | undefined;
}
export type AgentInvoke = (agent: Agent,) => AsyncGenerator<ToolResponseInfo, {
    message: AgentResponse;
    checkpointId: string;
    threadId: string;
}, unknown>;

export type IntermediateAgentResponse = ({
    type: "agentToAgentMessage",
} & AgentToAgentMessage) | {
    type: "toolResponse",
    agentName: string,
} & ToolResponseInfo;
export type AgentToAgentMessage = {
    sourceAgent: string,
    destinationAgent: string,
    content: InputAgentMessage
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
    content: InputAgentMessage,
}

const DESTINATION_AGENT_ATTRIBUTE = "destinationAgent";
export class OrchestratorBuilder {
    private readonly agentManager: Map<string, Agent> = new Map();

    constructor() {
    }

    /**
     * Initializes an agent using the provided factory and adds it to the orchestrator.
     * @param factory The factory to use for creating the agent
     * @param name The name of the agent
     * @param communicationWhitelist Optional whitelist of agent names this agent can communicate with
     * @param additionalPlugins Optional additional plugins to add to the agent
     * @returns The created agent
     */
    async initializeAgent(
        factory: AgentFactory,
        name: string,
        communicationWhitelist?: string[] | boolean
    ): Promise<Agent> {
        let whitelist = undefined;
        if (Array.isArray(communicationWhitelist)) {
            whitelist = communicationWhitelist;
        }
        
        const helpersPlugin = new HelpersPluginFactory({
            name: name,
            helperSingleton: this.agentManager,
            communicationWhitelist: whitelist ?? null,
            destinationAgentFieldName: DESTINATION_AGENT_ATTRIBUTE
        });

        const agent = await factory.create(name,  [helpersPlugin]);
        this.agentManager.set(name, agent);
        return agent;
    }

    build(currentAgent: Agent) {
        return new MultiAgentCommunicationOrchestrator(this.agentManager, currentAgent);
    }
}

export class MultiAgentCommunicationOrchestrator {
    public currentAgent: Agent;
    private agentStack: Agent[] = [];

    constructor(private readonly agentManager: ReadonlyMap<string, Agent>, currentAgent: Agent) {
        this.currentAgent = currentAgent;
    }

    getCurrentAgent() {
        return this.currentAgent;
    }

    async reset(args: {threadId:string, checkpointId?: string}) {
        for (const agent of this.agentManager.values()) {
            await agent.reset({threadId: args.threadId, checkpointId: args.checkpointId});
        }
    }

    async* handleMessage(msg: AgentInvoke): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {

        const handleMessage = async (graphResponse: AgentUserMessageResponse, agentStack: Agent[], threadId: string): Promise<{
            conversationComplete: boolean,
            currentAgent: Agent,
            pendingMessage: PendingMessage | undefined
        }> => {
            if (graphResponse.responseAttributes?.[DESTINATION_AGENT_ATTRIBUTE]) {
                const newAgent = this.agentManager.get(graphResponse.responseAttributes?.[DESTINATION_AGENT_ATTRIBUTE]);
                if (!newAgent) {
                    return {
                        conversationComplete: false,
                        currentAgent: this.currentAgent,
                        pendingMessage: {
                            replyFromAgent: undefined,
                            threadId: threadId,
                            content: {
                                content: [
                                    { type: "text", text: `Agent ${graphResponse.responseAttributes?.[DESTINATION_AGENT_ATTRIBUTE]} does not exist.` }
                                ]
                            },

                        }
                    }
                }
                agentStack.push(this.currentAgent);
                return {
                    conversationComplete: false,
                    currentAgent: newAgent,
                    pendingMessage: {
                        threadId: threadId,
                        replyFromAgent: undefined,
                        content: graphResponse.output
                    }
                }
            } else {
                const isFinalUser = agentStack.length === 0;
                return {
                    conversationComplete: isFinalUser,
                    currentAgent: isFinalUser ? this.currentAgent : agentStack.pop()!,
                    pendingMessage: {
                        threadId: threadId,
                        replyFromAgent: this.currentAgent.name,
                        content: graphResponse.output,
                    }
                }
            }
        }
        let pendingMessage: PendingMessage | undefined = undefined;
        while (true) {

            let generator = pendingMessage
                ? this.currentAgent.call({
                    threadId: pendingMessage.threadId,
                    message: {
                        ...pendingMessage.content,
                        content: [
                            {
                                type: "text",
                                text: pendingMessage.replyFromAgent ? `This message is from ${pendingMessage.replyFromAgent}:\n`: "",
                            },
                            ...pendingMessage.content.content,
                        ]
                    },
                    noMessagesInTool: true
                })
                : msg(this.currentAgent);


            let result: IteratorResult<ToolResponseInfo,{
                message: AgentResponse;
                checkpointId: string;
                threadId: string;
            }>;
            while (!(result = await generator.next()).done) {
                yield {
                    type: "toolResponse",
                    agentName: this.currentAgent.name,
                    ...result.value
                };
            }
            let graphResponse = result.value.message;

            if (graphResponse.type == "agentResponse") {
                const sourceAgent = this.currentAgent.name;
                const routedMessage = await handleMessage(graphResponse, this.agentStack, result.value.threadId);
                this.currentAgent = routedMessage.currentAgent;
                if (routedMessage.conversationComplete) {
                    return {
                        type: "agentResponse",
                        content: graphResponse.output,
                    };
                } else {
                    pendingMessage = routedMessage.pendingMessage;
                    yield {
                        type: "agentToAgentMessage",
                        sourceAgent: sourceAgent!,
                        destinationAgent: this.currentAgent.name,
                        content: graphResponse.output,
                    }
                }
            } else {
                return {
                    type: "toolRequest",
                    callingAgent: this.currentAgent.name,
                    content: graphResponse.output.content,
                    toolCalls: graphResponse.output.toolCalls,
                }
            }
        }
    }
}
