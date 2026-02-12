
import { z } from "zod/v4";
import { ComplexMessageContent } from "../schema.js";
//import { JSONSchema } from "@langchain/core/utils/json_schema";
type JSONSchema = Record<string, unknown>;
export type ToolResponse = ComplexMessageContent[];
export type ZodObjectAny = z.ZodObject;
export type ToolInputSchemaBase = z.ZodType | JSONSchema;

export type ToolInputSchemaOutputType<T extends ToolInputSchemaBase> = T extends z.ZodType ? z.output<T> : T extends JSONSchema ? unknown : never;
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
export type ToolInputSchemaInputType<T extends ToolInputSchemaBase> = T extends z.ZodType ? z.input<T> : T extends JSONSchema ? unknown : never;
export type StructuredToolCallInput<SchemaT extends ToolInputSchemaBase = ZodObjectAny, SchemaInputT = ToolInputSchemaInputType<SchemaT>> = (ToolInputSchemaOutputType<SchemaT> extends string ? string : never) | SchemaInputT;

export abstract class AgentTool<
    SchemaT extends ToolInputSchemaBase = ZodObjectAny,
    SchemaOutputT = ToolInputSchemaOutputType<SchemaT>,
    SchemaInputT = ToolInputSchemaInputType<SchemaT>,
    O extends z.ZodType = z.ZodType> {
    abstract schema: SchemaT;

    outSchema: z.ZodType | undefined = undefined

    protected abstract _call(
        arg: SchemaOutputT,
    ): Promise<ToolResponse>;

    async invoke(
        input: StructuredToolCallInput<SchemaT, SchemaInputT>
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
        arg: StructuredToolCallInput<SchemaT, SchemaInputT>,
    ): Promise<ToolResponse> {
        let parsed;
        try {
            parsed = await (this.schema as z.ZodType<SchemaOutputT, SchemaInputT>).parseAsync(arg);
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
} 
