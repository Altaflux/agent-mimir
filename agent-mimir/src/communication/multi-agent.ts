import { createAgent } from "../agent-manager/code-agent/index.js";
//import { createAgent } from "../agent-manager/function-agent/agent.js";
import { Agent, AgentResponse, AgentMessageToolRequest, AgentUserMessageResponse, ToolResponseInfo, InputAgentMessage, CreateAgentArgs } from "../agent-manager/index.js";
import { HelpersPluginFactory } from "../agent-manager/function-agent/helpers.js";

type PendingMessage = {
    content: InputAgentMessage;
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

type MultiAgentDefinition = CreateAgentArgs & { communicationWhitelist?: string[] | boolean }

const DESTINATION_AGENT_ATTRIBUTE = "destinationAgent";
export class OrchestratorBuilder {
    private readonly agentManager: Map<string, Agent> = new Map();

    constructor() {
    }

    async createAgent(args: MultiAgentDefinition): Promise<Agent> {

        const canCommunicateWithAgents = args.communicationWhitelist ?? false;
        let communicationWhitelist = undefined;
        if (Array.isArray(canCommunicateWithAgents)) {
            communicationWhitelist = canCommunicateWithAgents
        }
        const helpersPlugin = new HelpersPluginFactory({
            name: args.name,
            helperSingleton: this.agentManager,
            communicationWhitelist: communicationWhitelist ?? null,
            destinationAgentFieldName: DESTINATION_AGENT_ATTRIBUTE
        });


        const agent = await createAgent({
            name: args.name,
            description: args.description,
            profession: args.profession,
            model: args.model,
            visionSupport: args.visionSupport,
            constitution: args.constitution,
            plugins: [helpersPlugin, ...args.plugins ?? []],
            workspaceFactory: args.workspaceFactory,
        });

        this.agentManager.set(args.name, agent);
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

    async reset() {
        for (const agent of this.agentManager.values()) {
            await agent.reset();
        }
    }

    async* handleMessage(msg: AgentInvoke): AsyncGenerator<IntermediateAgentResponse, HandleMessageResult, void> {

        const handleMessage = async (graphResponse: AgentUserMessageResponse, agentStack: Agent[]): Promise<{
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
                        content: graphResponse.output
                    }
                }
            } else {
                const isFinalUser = agentStack.length === 0;
                return {
                    conversationComplete: isFinalUser,
                    currentAgent: isFinalUser ? this.currentAgent : agentStack.pop()!,
                    pendingMessage: {
                        content: graphResponse.output
                    }
                }
            }
        }
        let pendingMessage: PendingMessage | undefined = undefined;
        while (true) {

            let generator = pendingMessage
                ? this.currentAgent.call({
                    message: pendingMessage.content,
                    noMessagesInTool: true
                })
                : msg(this.currentAgent);


            let result: IteratorResult<ToolResponseInfo, AgentResponse>;
            while (!(result = await generator.next()).done) {
                yield {
                    type: "toolResponse",
                    agentName: this.currentAgent.name,
                    ...result.value
                };
            }
            let graphResponse = result.value;

            if (graphResponse.type == "agentResponse") {
                const sourceAgent = this.currentAgent.name;
                const routedMessage = await handleMessage(graphResponse, this.agentStack);
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
