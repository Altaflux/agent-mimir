import {
    Agent,
    AgentFactory,
    AgentHydrationEvent,
    AgentMessageToolRequest,
    AgentResponse,
    CommandRequest,
    InputAgentMessage,
    IntermediateAgentMessage,
    ToolResponseInfo
} from "../agent-manager/index.js";
import { ComplexMessageContent } from "../schema.js";

type AgentInvoke = (agent: Agent) => AsyncGenerator<IntermediateAgentMessage, {
    message: AgentResponse;
}, unknown>;

export type IntermediateOutputType = {
    type: "toolResponse";
    id: string;
    toolResponse: ToolResponseInfo;
} | {
    type: "messageChunk";
    id: string;
    content: ComplexMessageContent[];
};

export type IntermediateAgentResponse = {
    type: "intermediateOutput";
    agentName: string;
    value: IntermediateOutputType;
};

export type HandleMessageResult = ({
    type: "agentResponse";
} & AgentUserMessage) | ({
    type: "toolRequest";
} & AgentToolRequestTwo);

export type AgentToolRequestTwo = AgentMessageToolRequest & {
    callingAgent: string;
};

export type AgentUserMessage = {
    content: InputAgentMessage;
};

export type AgentHydrationEventWithAgent = AgentHydrationEvent & {
    agentName: string;
    sequence: number;
};

export type HydratedOrchestratorEvent = {
    type: "userMessage";
    timestamp: string;
    sourceAgent: string;
    value: InputAgentMessage;
} | {
    type: "intermediate";
    timestamp: string;
    value: IntermediateAgentResponse;
} | {
    type: "result";
    timestamp: string;
    agentName: string;
    value: HandleMessageResult;
};

export class OrchestratorBuilder {
    private readonly agentManager: Map<string, Agent> = new Map();

    constructor(private readonly sessionId: string) {
    }

    async initializeAgent(factory: AgentFactory, name: string): Promise<Agent> {
        const agent = await factory.create(name, []);
        this.agentManager.set(name.trim(), agent);
        return agent;
    }

    build(principalAgent: Agent) {
        return new MultiAgentCommunicationOrchestrator(this.agentManager, principalAgent, this.sessionId);
    }
}

/**
 * Principal-only agent runtime.
 *
 * The historical class name remains during the migration, but this no longer
 * performs peer-agent routing. A session has one user-facing principal agent;
 * future sub-agent work should be modeled as plugin/runtime tasks.
 */
export class MultiAgentCommunicationOrchestrator {
    public readonly currentAgent: Agent;

    constructor(
        private readonly agentManager: ReadonlyMap<string, Agent>,
        principalAgent: Agent,
        private readonly sessionId: string
    ) {
        this.currentAgent = principalAgent;
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
        abortSignal?: AbortSignal;
    }, sessionId: string): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {
        return yield* this.doInvocation((agent) => agent.call({
            message: args.message,
            requestAttributes: undefined,
            sessionId,
            abortSignal: args.abortSignal
        }));
    }

    async* handleCommand(args: {
        command: CommandRequest;
        abortSignal?: AbortSignal;
    }, sessionId: string): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {
        return yield* this.doInvocation((agent) => agent.handleCommand({
            command: args.command,
            sessionId,
            abortSignal: args.abortSignal
        }));
    }

    async hydrateConversation(hydrationEvents: AgentHydrationEventWithAgent[]): Promise<HydratedOrchestratorEvent[]> {
        hydrationEvents.sort((left, right) => this.compareHydrationEvents(left, right));

        const replayed: HydratedOrchestratorEvent[] = [];
        for (const event of hydrationEvents) {
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
                        callingAgent: event.agentName,
                        ...event.output
                    }
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
                        value: convertIntermediateAgentMessage(event.output)
                    }
                });
                continue;
            }

            replayed.push({
                type: "result",
                timestamp: event.timestamp,
                agentName: event.agentName,
                value: {
                    type: "agentResponse",
                    content: event.output
                }
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
        const generator = msg(this.currentAgent);
        let result: IteratorResult<IntermediateAgentMessage, {
            message: AgentResponse;
        }>;

        while (!(result = await generator.next()).done) {
            yield {
                type: "intermediateOutput",
                agentName: this.currentAgent.name,
                value: convertIntermediateAgentMessage(result.value)
            };
        }

        const graphResponse = result.value.message;
        if (graphResponse.type === "agentResponse") {
            return {
                type: "agentResponse",
                content: graphResponse.output
            };
        }

        return {
            type: "toolRequest",
            callingAgent: this.currentAgent.name,
            ...graphResponse.output
        };
    }
}

function convertIntermediateAgentMessage(intermediateAgentMessage: IntermediateAgentMessage): IntermediateOutputType {
    if (intermediateAgentMessage.type === "toolResponse") {
        return {
            type: "toolResponse",
            id: intermediateAgentMessage.id,
            toolResponse: intermediateAgentMessage.toolResponse
        };
    }

    if (intermediateAgentMessage.type === "messageChunk") {
        return {
            type: "messageChunk",
            id: intermediateAgentMessage.id,
            content: intermediateAgentMessage.content
        };
    }

    throw new Error(`Unknown intermediate agent message type: ${(intermediateAgentMessage as { type?: string }).type}`);
}
