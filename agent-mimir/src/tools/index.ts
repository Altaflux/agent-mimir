
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { z } from "zod";
import { MimirToolResponse } from "../schema.js";

export abstract class AgentTool<
    T extends z.ZodObject<any, any, any, any> = z.ZodObject<any, any, any, any>> {
    abstract schema: T | z.ZodEffects<T>;

    protected abstract _call(
        arg: z.output<T>,
        runManager?: CallbackManagerForToolRun
    ): Promise<MimirToolResponse>;

    async invoke(
        input: (z.output<T> extends string ? string : never) | z.input<T>
    ): Promise<MimirToolResponse> {
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
    ): Promise<MimirToolResponse> {
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