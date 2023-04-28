
import { Agent, BaseSingleActionAgent, StoppingMethod } from "langchain/agents";
import { BaseChain, ChainInputs, SerializedLLMChain } from "langchain/chains";
import { AgentAction, AgentFinish, AgentStep, ChainValues } from "langchain/schema";
import { Tool } from "langchain/tools";

interface AgentExecutorInput extends ChainInputs {
    agent: Agent;
    tools: Tool[];
    returnIntermediateSteps?: boolean;
    maxIterations?: number;
    earlyStoppingMethod?: StoppingMethod;
    continuousMode?: boolean,
}


export class SteppedAgentExecutor extends BaseChain {
    get outputKeys(): string[] {
        return this.agent.returnValues
    }
    agent: BaseSingleActionAgent;

    tools: Tool[];

    returnIntermediateSteps = false;

    maxIterations?: number = 15;

    earlyStoppingMethod: StoppingMethod = "force";

    pendingAgentAction?: AgentAction;

    continuousMode = false;

    get inputKeys() {
        return this.agent.inputKeys;
    }

    constructor(input: AgentExecutorInput) {
        super(undefined, input.verbose, input.callbackManager);
        const tools = [...input.tools];
        this.agent = input.agent;
        this.tools = tools;
        this.returnIntermediateSteps =
            input.returnIntermediateSteps ?? this.returnIntermediateSteps;
        this.maxIterations = input.maxIterations ?? this.maxIterations;
        this.earlyStoppingMethod =
            input.earlyStoppingMethod ?? this.earlyStoppingMethod;
        this.continuousMode = input.continuousMode ?? this.continuousMode;

    }


    static fromAgentAndTools(fields: AgentExecutorInput): SteppedAgentExecutor {
        return new SteppedAgentExecutor(fields);
    }

    private shouldContinue(iterations: number): boolean {
        return this.maxIterations === undefined || iterations < this.maxIterations;
    }


    async doTool(action: AgentAction, toolsByName: { [k: string]: Tool }, steps: AgentStep[], getOutput: (finishStep: AgentFinish)
        => Promise<ChainValues>) {

        const tool = toolsByName[action.tool?.toLowerCase()];
        const observation = tool
            ? await tool.call(action.toolInput)
            : `${action.tool} is not a valid tool, try another one.`;
        steps.push({ action, observation });

        if (tool?.returnDirect) {
            return {
                storeInMem: true,
                workPending: true,
                chainValues: await getOutput({
                    returnValues: { [this.agent.returnValues[0]]: observation },
                    log: "",
                })
            };
        }
    }

    async _call(inputs: ChainValues): Promise<ChainValues> {

        const fullValues = { ...inputs } as typeof inputs;

        const output = await this._invoke(fullValues);

        return output.chainValues;
    }

    async _invoke(inputs: ChainValues): Promise<{ storeInMem: boolean, workPending: boolean, chainValues: ChainValues }> {

        const toolsByName = Object.fromEntries(
            this.tools.map((t) => [t.name.toLowerCase(), t])
        );
        const steps: AgentStep[] = [];
        let iterations = 0;
        const getOutput = async (finishStep: AgentFinish) => {
            const { returnValues } = finishStep;
            const additional = await this.agent.prepareForOutput(returnValues, steps);

            if (this.returnIntermediateSteps) {
                return { ...returnValues, intermediateSteps: steps, ...additional };
            }

            return { ...returnValues, ...additional };
        };


        while (this.shouldContinue(iterations)) {

            if (!this.pendingAgentAction) {

                const action = await this.agent.plan(steps, inputs);
                if ("returnValues" in action) {
                    return {
                        workPending: false, //??
                        chainValues: await getOutput(action),
                        storeInMem: true
                    };
                }
                if (!this.continuousMode && action.tool !== "talkToUser") {
                    this.pendingAgentAction = action;
                    return {
                        storeInMem: false,
                        workPending: true, //??
                        chainValues: await getOutput({
                            returnValues: { [this.agent.returnValues[0]]: action.log, toolStep: true },
                            log: action.log,
                        })
                    };
                }

                const out = await this.doTool(action, toolsByName, steps, getOutput);
                if (out) {
                    return out;
                }
            }

            else if (inputs.continue) {
                const action = this.pendingAgentAction;
                this.pendingAgentAction = undefined;
                const out = await this.doTool(action, toolsByName, steps, getOutput);
                if (out) {
                    return out;
                }
            } else {
                const action = this.pendingAgentAction;
                this.pendingAgentAction = undefined;
                steps.push({ action, observation: inputs.input });
            }
            iterations += 1;
        }

        const finish = await this.agent.returnStoppedResponse(
            this.earlyStoppingMethod,
            steps,
            inputs
        );

        return {
            storeInMem: false,
            workPending: true,
            chainValues: getOutput(finish),
        };
    }

    _chainType() {
        return "stepped_agent_executor" as const;
    }

    serialize(): SerializedLLMChain {
        throw new Error("Cannot serialize an AgentExecutor");
    }
}
