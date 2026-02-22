import { Agent, AgentHydrationEvent, AgentResponse, AgentMessageToolRequest, AgentUserMessageResponse, InputAgentMessage, AgentFactory, CommandRequest, IntermediateAgentMessage, ToolResponseInfo } from "../agent-manager/index.js";
import { ComplexMessageContent } from "../schema.js";
import { HelpersPluginFactory } from "./helpers.js";

type PendingMessage = {
    content: InputAgentMessage;
    fromAgent: string | undefined;
    toAgent: string | undefined;
}
type AgentInvoke = (agent: Agent,) => AsyncGenerator<IntermediateAgentMessage, {
    message: AgentResponse;
}, unknown>;


export type IntermediateOutputType = {
    type: "toolResponse",
    id: string,
    toolResponse: ToolResponseInfo
} |
{
    type: "messageChunk",
    id: string,
    destinationAgent: string | undefined,
    content: ComplexMessageContent[],
};

export type IntermediateAgentResponse = ({
    type: "agentToAgentMessage",
    value: AgentToAgentMessage
}) |
{
    type: "intermediateOutput",
    agentName: string,
    value: IntermediateOutputType
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
    destinationAgent: string | undefined,
}

export type AgentUserMessage = {
    content: InputAgentMessage,
}

type AgentHydrationEventWithAgent = AgentHydrationEvent & {
    agentName: string,
    sequence: number,
}

export type HydratedOrchestratorEvent = {
    type: "userMessage",
    timestamp: string,
    sourceAgent: string,
    value: InputAgentMessage
} | {
    type: "intermediate",
    timestamp: string,
    value: IntermediateAgentResponse
} | {
    type: "result",
    timestamp: string,
    agentName: string,
    value: HandleMessageResult
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

    async reset() {
        for (const agent of this.agentManager.values()) {
            await agent.reset({ sessionId: this.sessionId });
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
        return yield* this.doInvocation((agent) => agent.call({ message: args.message, requestAttributes: undefined, sessionId: sessionId }));
    }

    async* handleCommand(args: {
        command: CommandRequest;
    }, sessionId: string): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {
        return yield* this.doInvocation((agent) => agent.handleCommand({ command: args.command, sessionId: sessionId }));
    }

    async hydrateConversation(sessionId: string): Promise<HydratedOrchestratorEvent[]> {
        const hydrationEvents: AgentHydrationEventWithAgent[] = [];
        let sequence = 0;

        for (const agent of this.agentManager.values()) {
            const events = await agent.readHydrationEvents({ sessionId });
            for (const event of events) {
                hydrationEvents.push({
                    ...event,
                    agentName: agent.name,
                    sequence: sequence++,
                });
            }
        }

        hydrationEvents.sort((left, right) => this.compareHydrationEvents(left, right));
        this.agentStack = [];

        const replayed: HydratedOrchestratorEvent[] = [];
        for (const event of hydrationEvents) {
            const sourceAgent = this.agentManager.get(event.agentName);
            if (sourceAgent) {
                this.currentAgent = sourceAgent;
            }

            if (event.type === "userMessage") {
                replayed.push({
                    type: "userMessage",
                    timestamp: event.timestamp,
                    sourceAgent: event.agentName,
                    value: event.content
                });
                continue;
            }

            if (event.type === "toolRequest") {
                replayed.push({
                    type: "result",
                    timestamp: event.timestamp,
                    agentName: event.agentName,
                    value: {
                        type: "toolRequest",
                        destinationAgent: this.agentStack.at(-1)?.name,
                        callingAgent: event.agentName,
                        ...event.output,
                    },
                });
                continue;
            }

            if (event.type === "toolResponse") {
                replayed.push({
                    type: "intermediate",
                    timestamp: event.timestamp,
                    value: {
                        type: "intermediateOutput",
                        agentName: event.agentName,
                        value: event.output
                    }
                });
                continue;
            }

            const routedMessage = this.routeAgentResponse(
                {
                    type: "agentResponse",
                    checkpointId: event.checkpointId,
                    output: event.output,
                    responseAttributes: event.responseAttributes,
                },
                this.agentStack
            );
            const messageSourceAgent = this.currentAgent.name;
            this.currentAgent = routedMessage.currentAgent;

            if (routedMessage.conversationComplete) {
                replayed.push({
                    type: "result",
                    timestamp: event.timestamp,
                    agentName: messageSourceAgent,
                    value: {
                        type: "agentResponse",
                        content: event.output,
                    },
                });
                continue;
            }

            replayed.push({
                type: "intermediate",
                timestamp: event.timestamp,
                value: {
                    type: "agentToAgentMessage",
                    value: {
                        content: event.output,
                        destinationAgent: this.currentAgent.name,
                        sourceAgent: messageSourceAgent,
                    },
                },
            });
        }

        return replayed;
    }

    private compareHydrationEvents(left: AgentHydrationEventWithAgent, right: AgentHydrationEventWithAgent): number {
        const leftTimestamp = Date.parse(left.timestamp);
        const rightTimestamp = Date.parse(right.timestamp);
        if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && leftTimestamp !== rightTimestamp) {
            return leftTimestamp - rightTimestamp;
        }

        if (left.checkpointId !== right.checkpointId) {
            return left.checkpointId.localeCompare(right.checkpointId);
        }

        if (left.agentName !== right.agentName) {
            return left.agentName.localeCompare(right.agentName);
        }

        return left.sequence - right.sequence;
    }

    private async* doInvocation(msg: AgentInvoke): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {
        let pendingMessage: PendingMessage | undefined = undefined;
        while (true) {

            let generator = pendingMessage
                ? this.currentAgent.call({
                    sessionId: this.sessionId,
                    requestAttributes: { "messageFromAgent": pendingMessage.fromAgent },
                    message: {
                        ...pendingMessage.content,
                        content: [
                            {
                                type: "text",
                                text: pendingMessage.fromAgent ? `This message is from ${pendingMessage.fromAgent}:\n` : "",
                            },
                            ...pendingMessage.content.content,
                        ]
                    },
                    noMessagesInTool: true,

                })
                : msg(this.currentAgent);


            let result: IteratorResult<IntermediateAgentMessage, {
                message: AgentResponse;
            }>;
            while (!(result = await generator.next()).done) {
                const intermediateOutputType = convertIntermediateAgentMessage(result.value, this.agentStack.at(-1)?.name);
                yield {
                    type: "intermediateOutput",
                    agentName: this.currentAgent.name,
                    value: intermediateOutputType
                };
            }
            let graphResponse = result.value.message;

            if (graphResponse.type == "agentResponse") {
                const sourceAgent = this.currentAgent.name;
                const routedMessage = this.routeAgentResponse(graphResponse, this.agentStack);
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
                    destinationAgent: this.agentStack.at(-1)?.name,
                    ...graphResponse.output,
                }
            }
        }
    }

    private routeAgentResponse(graphResponse: AgentUserMessageResponse, agentStack: Agent[]): {
        conversationComplete: boolean,
        currentAgent: Agent,
        pendingMessage: PendingMessage | undefined
    } {

        const destinationAgentName = graphResponse.responseAttributes?.[DESTINATION_AGENT_ATTRIBUTE];
        if (destinationAgentName && (this.agentStack.length === 0 || destinationAgentName !== this.agentStack[this.agentStack.length - 1].name)) {

            const newAgent = this.agentManager.get(destinationAgentName);
            if (!newAgent) {
                return {
                    conversationComplete: false,
                    currentAgent: this.currentAgent,
                    pendingMessage: {
                        toAgent: destinationAgentName,
                        fromAgent: this.currentAgent.name,
                        content: {
                            content: [
                                { type: "text", text: `Agent ${destinationAgentName} does not exist.` }
                            ]
                        },
                    }
                };
            }
            agentStack.push(this.currentAgent);
            return {
                conversationComplete: false,
                currentAgent: newAgent,
                pendingMessage: {
                    toAgent: newAgent.name,
                    fromAgent: this.currentAgent.name,
                    content: graphResponse.output
                }
            };
        }

        const isFinalUser = agentStack.length === 0;
        const newCurrentAgent = isFinalUser ? this.currentAgent : agentStack.pop()!;
        return {
            conversationComplete: isFinalUser,
            currentAgent: newCurrentAgent,
            pendingMessage: {
                toAgent: undefined,
                fromAgent: this.currentAgent.name,
                content: graphResponse.output,
            }
        };
    }
}

function convertIntermediateAgentMessage(intermediateAgentMessage: IntermediateAgentMessage, agentName: string | undefined): IntermediateOutputType {
    if (intermediateAgentMessage.type === "toolResponse") {
        return {
            type: "toolResponse",
            id: intermediateAgentMessage.id,
            toolResponse: intermediateAgentMessage.toolResponse
        }
    }
    if (intermediateAgentMessage.type === "messageChunk") {
        return {
            type: "messageChunk",
            id: intermediateAgentMessage.id,
            destinationAgent: intermediateAgentMessage.responseAttributes?.[DESTINATION_AGENT_ATTRIBUTE] ?? agentName,
            content: intermediateAgentMessage.content,
        }
    }
    throw new Error(`Unknown intermediate agent message type: ${(intermediateAgentMessage as any).type}`);
}