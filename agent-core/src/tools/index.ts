import { z as z3 } from "zod/v3";
import { z as z4 } from "zod/v4";
import { ComplexMessageContent } from "../schema.js";
import { JsonSchema7Type } from "@langchain/core/utils/json_schema";
import { InferInteropZodInput, InferInteropZodOutput, InteropZodType, interopParseAsync } from "@langchain/core/utils/types";

type JSONSchema = Record<string, unknown>;
export type ToolResponse = ComplexMessageContent[];

export type ToolInputSchemaBase = InteropZodType | JsonSchema7Type;


export type ToolInputSchemaOutputType<T> = T extends InteropZodType
  ? InferInteropZodOutput<T>
  : T extends JSONSchema
    ? unknown
    : never;
export type ToolInputSchemaInputType<T> = T extends InteropZodType ? InferInteropZodInput<T> : T extends JsonSchema7Type ? unknown : never;
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

export type StructuredToolCallInput<
  SchemaT = ToolInputSchemaBase,
  SchemaInputT = ToolInputSchemaInputType<SchemaT>,
> =
  | (ToolInputSchemaOutputType<SchemaT> extends string ? string : never)
  | SchemaInputT
  ;

export abstract class AgentTool<
    SchemaT = ToolInputSchemaBase,
    SchemaOutputT =  ToolInputSchemaOutputType<SchemaT>,
    SchemaInputT = ToolInputSchemaInputType<SchemaT>> {
    abstract schema: SchemaT;

    outSchema: z3.ZodType | z4.ZodType | undefined = undefined

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
    async call<TArg extends StructuredToolCallInput<SchemaT, SchemaInputT>>(
        arg: TArg,
    ): Promise<ToolResponse> {
        let parsed: SchemaOutputT;
          const inputForValidation = arg;
         parsed = await interopParseAsync(
            this.schema as InteropZodType,
            inputForValidation as TArg
            );


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
