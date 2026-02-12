
import { z } from "zod/v4";
import type { z as z3 } from "zod/v3";
import { ComplexMessageContent } from "../schema.js";


export type ToolResponse = ComplexMessageContent[];
import { type JsonSchema7Type } from "zod-to-json-schema";
export type JSONSchema = JsonSchema7Type;
export type ToolInputSchemaBase = z3.ZodTypeAny | JSONSchema;

import { StructuredToolCallInput } from "@langchain/core/tools"
import { type InferInteropZodInput, InferInteropZodOutput, InteropZodType } from "@langchain/core/utils/types";
export type ToolInputSchemaOutputType<T> = T extends InteropZodType ? InferInteropZodOutput<T> : T extends JSONSchema ? unknown : never;

/**
 * Utility type that resolves the input type of a tool input schema.
 *
 * Input & Output types are a concept used with Zod schema, as Zod allows for transforms to occur
 * during parsing. When using JSONSchema, input and output types are the same.
 *
 * The input type for a given schema should match the structure of the arguments that the LLM
 * generates as part of its {@link ToolCall}. The output type will be the type that results from
 * applying any transforms defined in your schema. If there are no transforms, the input and output
 * types will be the same.
 */

export type ToolInputSchemaInputType<T> = T extends InteropZodType ? InferInteropZodInput<T> : T extends JSONSchema ? unknown : never;
export type ToolOutputType = any;
export abstract class AgentTool<SchemaT = ToolInputSchemaBase, SchemaOutputT = ToolInputSchemaOutputType<SchemaT>, SchemaInputT = ToolInputSchemaInputType<SchemaT>, ToolOutputT = ToolOutputType> {
    abstract schema: SchemaT;

    outSchema: z.ZodType | undefined = undefined

    protected abstract _call(
        arg: SchemaOutputT,
    ): Promise<ToolResponse>;

    async invoke<TInput extends StructuredToolCallInput<SchemaT, SchemaInputT>>(
        input: TInput
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
    async call<TInput extends StructuredToolCallInput<SchemaT, SchemaInputT>>(
        arg: TInput,
    ): Promise<ToolResponse> {
        let parsed;
        try {
            parsed = await (this.schema as z.ZodSchema).parseAsync(arg);
        } catch (e) {
            throw new Error(
                `Received tool input did not match expected schema ${JSON.stringify(arg)}`,
            );
        }

        let result;
        try {
            result = await this._call(parsed as SchemaOutputT);
        } catch (e) {

            throw e;
        }
        return result;
    }

    abstract name: string;

    abstract description: string;
} 