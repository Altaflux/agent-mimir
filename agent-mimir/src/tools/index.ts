
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { z } from "zod";
import { ComplexMessageContent } from "../schema.js";
import { AgentMessage } from "../agent-manager/index.js";


export type ToolResponse = ComplexMessageContent[] | AgentMessage | {
    rawResponse: any
};


export abstract class AgentTool<
    T extends z.ZodObject<any, any, any, any> = z.ZodObject<any, any, any, any>> {
    abstract schema: T | z.ZodEffects<T>;

    protected abstract _call(
        arg: z.output<T>,
        runManager?: CallbackManagerForToolRun
    ): Promise<ToolResponse>;

    async invoke(
        input: (z.output<T> extends string ? string : never) | z.input<T>
    ): Promise<ToolResponse> {
        return this.call(input);
    }

    /**
     * Calls the tool with the provided argument, configuration, and tags. It
     * parses the input according to the schema, handles any errors, and
     * manages callbacks.
     * @param arg The input argument for the tool.
     * @param configArg Optional configuration or callbacks for the tool.
     * @param tags Optional tags for the tool.
     * @returns A Promise that resolves with a string.
     */
    async call(
        arg: (z.output<T> extends string ? string : never) | z.input<T>,
    ): Promise<ToolResponse> {
        let parsed;
        try {
            parsed = await this.schema.parseAsync(arg);
        } catch (e) {
            throw new Error(
                `Received tool input did not match expected schema ${JSON.stringify(arg)}`,
            );
        }

        let result;
        try {
            result = await this._call(parsed);
        } catch (e) {

            throw e;
        }
        return result;
    }

    abstract name: string;

    abstract description: string;

    returnDirect = false;
} 