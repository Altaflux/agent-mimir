import {
    BaseMessage,
    ToolMessage,
    AIMessage,
    isBaseMessage,
} from "@langchain/core/messages";
import { RunnableConfig, RunnableToolLike } from "@langchain/core/runnables";
import { StructuredToolInterface } from "@langchain/core/tools";
import { END, isCommand, isGraphInterrupt, MessagesAnnotation } from "@langchain/langgraph";

export type ToolNodeOptions = {
    name?: string;
    tags?: string[];
    handleToolErrors?: boolean;
};

export const toolNodeFunction = (
    tools: (StructuredToolInterface | RunnableToolLike)[],
    options?: ToolNodeOptions) => {

    return async (input: typeof MessagesAnnotation.State, config: RunnableConfig) => {
        const message = Array.isArray(input)
            ? input[input.length - 1]
            : input.messages[input.messages.length - 1];

        if (message?._getType() !== "ai") {
            throw new Error("ToolNode only accepts AIMessages as input.");
        }

        const outputs = [];
        for (const call of (message as AIMessage).tool_calls ?? []) {
            const tool = tools.find((tool) => tool.name === call.name);
            try {
                if (tool === undefined) {
                    throw new Error(`Tool "${call.name}" not found.`);
                }
                const output = await tool.invoke(
                    { ...call, type: "tool_call" },
                    config
                );
                if (
                    (isBaseMessage(output) && output._getType() === "tool") ||
                    isCommand(output)
                ) {
                    outputs.push(output);
                } else {
                    outputs.push(new ToolMessage({
                        name: tool.name,
                        content:
                            typeof output === "string" ? output : JSON.stringify(output),
                        tool_call_id: call.id!,
                    }));
                }

            } catch (e: any) {
                if (!options?.handleToolErrors) {
                    throw e;
                }
                if (isGraphInterrupt(e.name)) {
                    // `NodeInterrupt` errors are a breakpoint to bring a human into the loop.
                    // As such, they are not recoverable by the agent and shouldn't be fed
                    // back. Instead, re-throw these errors even when `handleToolErrors = true`.
                    throw e;
                }
                outputs.push(new ToolMessage({
                    content: `Error: ${e.message}\n Please fix your mistakes.`,
                    name: call.name,
                    tool_call_id: call.id ?? "",
                }));
            }
        }

        // Preserve existing behavior for non-command tool outputs for backwards compatibility
        if (!outputs.some(isCommand)) {
            return (Array.isArray(input) ? outputs : { messages: outputs }) as any;
        }

        // Handle mixed Command and non-Command outputs
        const combinedOutputs = outputs.map((output) => {
            if (isCommand(output)) {
                return output;
            }
            return Array.isArray(input) ? [output] : { messages: [output] };
        });
        return combinedOutputs as any;
    }
};


export function toolsCondition(
    state: BaseMessage[] | typeof MessagesAnnotation.State
): "tools" | typeof END {
    const message = Array.isArray(state)
        ? state[state.length - 1]
        : state.messages[state.messages.length - 1];

    if (
        "tool_calls" in message &&
        ((message as AIMessage).tool_calls?.length ?? 0) > 0
    ) {
        return "tools";
    } else {
        return END;
    }
}
