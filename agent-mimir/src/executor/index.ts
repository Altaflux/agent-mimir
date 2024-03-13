import { StructuredTool, StructuredToolInterface } from "@langchain/core/tools";
import { AgentAction, AgentFinish, AgentStep, BaseSingleActionAgent, StoppingMethod } from "langchain/agents";
import { BaseChain, ChainInputs } from "langchain/chains";
import { AgentToolRequest, FunctionResponseCallBack, ToolResponse } from "../schema.js";
import { ChainValues } from "@langchain/core/utils/types";

interface AgentExecutorInput extends ChainInputs {
    agent: BaseSingleActionAgent;
    tools: StructuredTool[];
    agentName: string;
    returnIntermediateSteps?: boolean;
    maxIterations?: number;
    earlyStoppingMethod?: StoppingMethod;
    alwaysAllowTools?: string[];
}


export class SteppedAgentExecutor extends BaseChain {
    get outputKeys(): string[] {
        return this.agent.returnValues
    }

    agent: BaseSingleActionAgent;

    tools: this["agent"]["ToolType"][];

    agentName: string;

    returnIntermediateSteps = false;

    maxIterations?: number = 10;

    earlyStoppingMethod: StoppingMethod = "force";

    pendingAgentAction?: AgentAction;

    alwaysAllowTools: string[];

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
        this.alwaysAllowTools = input.alwaysAllowTools ?? [];
        this.agentName = input.agentName;
    }


    static fromAgentAndTools(fields: AgentExecutorInput): SteppedAgentExecutor {
        return new SteppedAgentExecutor(fields);
    }

    private shouldContinue(iterations: number): boolean {
        return this.maxIterations === undefined || iterations < this.maxIterations;
    }


    async doTool(action: AgentAction, toolsByName: { [k: string]: StructuredToolInterface }, steps: AgentStep[], getOutput: (finishStep: AgentFinish)
        => Promise<ChainValues>, functionInvokationListener: FunctionResponseCallBack) {

        const tool = toolsByName[action.tool?.toLowerCase()];
        const observation = tool
            ? await tool.call(action.toolInput)
            : JSON.stringify({ text: `"${action.tool}" is not a valid tool, try another one.` } as ToolResponse);

        if (!tool?.returnDirect) {
            functionInvokationListener(action.tool?.toLowerCase() ?? "", JSON.stringify(action.toolInput, null, 2), observation);
        }

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

        const continuousMode = inputs.continuousMode !== undefined ? inputs.continuousMode : true;
        const functionInvokationListener: FunctionResponseCallBack = inputs.functionResponseCallBack !== undefined ? inputs.functionResponseCallBack : () => Promise<void>;
        const fullValues = { ...inputs } as typeof inputs;
        const output = await this._invoke(continuousMode, fullValues, functionInvokationListener);

        return output.chainValues;
    }

    async _invoke(continuousMode: boolean, inputs: ChainValues, functionInvokationListener: FunctionResponseCallBack): Promise<{ storeInMem: boolean, workPending: boolean, chainValues: ChainValues }> {

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
            return { log: finishStep.log, ...returnValues, ...additional }
        };


        while (this.shouldContinue(iterations)) {

            if (!this.pendingAgentAction) {

                const action = await this.agent.plan(steps, inputs);
                if (process.env.MIMIR_LOG_AI_RESPONSE) {
                    console.log('\x1b[34m', `"${this.agentName}" responded with: "${action.log}".`)
                }

                if ("returnValues" in action) {
                    return {
                        workPending: false,
                        chainValues: await getOutput(action),
                        storeInMem: true
                    };
                }
                if (!continuousMode && this.alwaysAllowTools.includes(action.tool) === false) {
                    this.pendingAgentAction = action;
                    return {
                        storeInMem: false,
                        workPending: true,
                        chainValues: await getOutput({
                            returnValues: {
                                [this.agent.returnValues[0]]: JSON.stringify({
                                    toolName: action.tool,
                                    toolArguments: JSON.stringify(action.toolInput, null, 2),
                                } as AgentToolRequest),
                                toolStep: true
                            },
                            log: action.log,
                        })
                    };
                }

                const out = await this.doTool(action, toolsByName, steps, getOutput, functionInvokationListener);
                if (out) {
                    return out;
                }
            }

            else if (inputs.continue) {
                const action = this.pendingAgentAction;
                this.pendingAgentAction = undefined;
                const out = await this.doTool(action, toolsByName, steps, getOutput, functionInvokationListener);
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

   
}
