import { Agent, AgentResponse, AgentMessageToolRequest, AgentUserMessageResponse, InputAgentMessage, AgentFactory, CommandRequest, IntermediateAgentMessage } from "../agent-manager/index.js";
import { HelpersPluginFactory } from "./helpers.js";

type PendingMessage = {
    content: InputAgentMessage;

    replyFromAgent: string | undefined;
}
type AgentInvoke = (agent: Agent,) => AsyncGenerator<IntermediateAgentMessage, {
    message: AgentResponse;
}, unknown>;

export type IntermediateAgentResponse = ({
    type: "agentToAgentMessage",
    value: AgentToAgentMessage
} ) | {
    type: "intermediateOutput",
    agentName: string,
    value: IntermediateAgentMessage
};

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

    constructor(private readonly sessionId: string) {
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

        const agent = await factory.create(name, [helpersPlugin]);
        this.agentManager.set(name, agent);
        return agent;
    }

    build(currentAgent: Agent) {
        return new MultiAgentCommunicationOrchestrator(this.agentManager, currentAgent, this.sessionId);
    }
}

export class MultiAgentCommunicationOrchestrator {
    public currentAgent: Agent;
    private agentStack: Agent[] = [];

    constructor(private readonly agentManager: ReadonlyMap<string, Agent>, currentAgent: Agent, private readonly sessionId: string) {
        this.currentAgent = currentAgent;
    }

    getCurrentAgent() {
        return this.currentAgent;
    }

    async reset(args: { checkpointId?: string }) {
        for (const agent of this.agentManager.values()) {
            await agent.reset({ sessionId: this.sessionId, checkpointId: args.checkpointId });
        }
    }

    async shutDown() {
        for (const agent of this.agentManager.values()) {
            await agent.shutDown();
        }
    }

    async* handleMessage(args: {
        message: InputAgentMessage | null;
    }, sessionId: string): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {
        return yield* this.doInvocation((agent) => agent.call({ message: args.message, sessionId: sessionId }), sessionId);
    }

    async* handleCommand(args: {
        command: CommandRequest;
    }, sessionId: string): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {
        return yield* this.doInvocation((agent) => agent.handleCommand({ command: args.command, sessionId: sessionId }), sessionId);
    }


    private async* doInvocation(msg: AgentInvoke, threadId: string): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {

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
                    sessionId: this.sessionId,
                    message: {
                        ...pendingMessage.content,
                        content: [
                            {
                                type: "text",
                                text: pendingMessage.replyFromAgent ? `This message is from ${pendingMessage.replyFromAgent}:\n` : "",
                            },
                            ...pendingMessage.content.content,
                        ]
                    },
                    noMessagesInTool: true
                })
                : msg(this.currentAgent);


            let result: IteratorResult<IntermediateAgentMessage, {
                message: AgentResponse;
            }>;
            while (!(result = await generator.next()).done) {
                yield {
                    type: "intermediateOutput",
                    agentName: this.currentAgent.name,
                    value: result.value
                };
            }
            let graphResponse = result.value.message;

            if (graphResponse.type == "agentResponse") {
                const sourceAgent = this.currentAgent.name;
                const routedMessage = await handleMessage(graphResponse, this.agentStack, threadId);
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
                        value: {
                            content: graphResponse.output,
                            destinationAgent: this.currentAgent.name,
                            sourceAgent: sourceAgent!,
                        }
                    }
                }
            } else {
                return {
                    type: "toolRequest",
                    callingAgent: this.currentAgent.name,
                    ...graphResponse.output,
                }
            }
        }
    }
}
