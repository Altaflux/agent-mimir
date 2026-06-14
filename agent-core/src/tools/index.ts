import { z as z3 } from "zod/v3";
import { z as z4 } from "zod/v4";
import { ComplexMessageContent } from "../schema.js";
import { JsonSchema7Type } from "@langchain/core/utils/json_schema";
import {
  InferInteropZodInput,
  InferInteropZodOutput,
  InteropZodType,
  interopParseAsync,
} from "@langchain/core/utils/types";
import { AsyncLocalStorage } from "async_hooks";
import type {
  PluginElicitationCreateRequest,
  PluginElicitationResponse,
  PluginElicitationRuntime,
  PluginRuntimeEventInput,
} from "../plugins/index.js";

type JSONSchema = Record<string, unknown>;
export type ToolResponse = ComplexMessageContent[];

export type ToolInputSchemaBase = InteropZodType | JsonSchema7Type;

export type ToolInputSchemaOutputType<T> = T extends InteropZodType
  ? InferInteropZodOutput<T>
  : T extends JSONSchema
    ? unknown
    : never;
export type ToolInputSchemaInputType<T> = T extends InteropZodType
  ? InferInteropZodInput<T>
  : T extends JsonSchema7Type
    ? unknown
    : never;
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
  | SchemaInputT;

export type ToolCallRuntimeSource = {
  toolCallId: string;
  toolName: string;
};

export type ToolCallRuntimeContext = ToolCallRuntimeSource & {
  emitEvent(input: PluginRuntimeEventInput): void | Promise<void>;
  elicitation: PluginElicitationRuntime;
};

export type ToolRuntimeProvider = {
  forToolCall(source: ToolCallRuntimeSource): ToolCallRuntimeContext;
};

const toolCallRuntimeStorage = new AsyncLocalStorage<ToolCallRuntimeSource>();

export function runWithToolCallRuntimeSource<T>(
  source: ToolCallRuntimeSource,
  operation: () => Promise<T>,
): Promise<T> {
  return toolCallRuntimeStorage.run(source, operation);
}

function isToolCallRuntimeContext(
  value: ToolCallRuntimeContext | ToolCallRuntimeSource,
): value is ToolCallRuntimeContext {
  return typeof (value as ToolCallRuntimeContext).emitEvent === "function";
}

function createNoopToolCallRuntimeContext(
  toolName: string,
  source?: Partial<ToolCallRuntimeSource>,
): ToolCallRuntimeContext {
  return {
    toolCallId: source?.toolCallId ?? "standalone",
    toolName: source?.toolName ?? toolName,
    emitEvent() {
      return;
    },
    elicitation: createNoopElicitationRuntime(),
  };
}

function createNoopElicitationRuntime(): PluginElicitationRuntime {
  return {
    async create(
      _input: PluginElicitationCreateRequest,
    ): Promise<PluginElicitationResponse> {
      return { action: "cancel" };
    },
    complete() {
      return;
    },
  };
}

export abstract class AgentTool<
  SchemaT = ToolInputSchemaBase,
  SchemaOutputT = ToolInputSchemaOutputType<SchemaT>,
  SchemaInputT = ToolInputSchemaInputType<SchemaT>,
> {
  abstract schema: SchemaT;

  outSchema: z3.ZodType | z4.ZodType | undefined = undefined;

  private runtimeBinding?: {
    runtimeProvider: ToolRuntimeProvider;
  };

  bindPluginRuntime(runtimeProvider: ToolRuntimeProvider): this {
    this.runtimeBinding = {
      runtimeProvider,
    };
    return this;
  }

  protected abstract _call(
    arg: SchemaOutputT,
    context: ToolCallRuntimeContext,
  ): Promise<ToolResponse>;

  async invoke<TInput extends StructuredToolCallInput<SchemaT, SchemaInputT>>(
    input: TInput,
    context?: ToolCallRuntimeContext | ToolCallRuntimeSource,
  ): Promise<ToolResponse> {
    return this.call(input, context);
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
    context?: ToolCallRuntimeContext | ToolCallRuntimeSource,
  ): Promise<ToolResponse> {
    let parsed: SchemaOutputT;
    const inputForValidation = arg;
    parsed = await interopParseAsync(
      this.schema as InteropZodType,
      inputForValidation as TArg,
    );

    let result;
    try {
      result = await this._call(
        parsed,
        this.resolveToolCallRuntimeContext(context),
      );
    } catch (e) {
      throw e;
    }
    return result;
  }

  async invokeParsed(
    arg: SchemaOutputT,
    context?: ToolCallRuntimeContext | ToolCallRuntimeSource,
  ): Promise<ToolResponse> {
    return this._call(arg, this.resolveToolCallRuntimeContext(context));
  }

  abstract name: string;

  abstract description: string;

  private resolveToolCallRuntimeContext(
    context?: ToolCallRuntimeContext | ToolCallRuntimeSource,
  ): ToolCallRuntimeContext {
    if (context) {
      if (isToolCallRuntimeContext(context)) {
        return {
          ...context,
          elicitation:
            (context as Partial<ToolCallRuntimeContext>).elicitation ??
            createNoopElicitationRuntime(),
        };
      }

      return (
        this.runtimeBinding?.runtimeProvider.forToolCall(context) ??
        createNoopToolCallRuntimeContext(this.name, context)
      );
    }

    const activeSource = toolCallRuntimeStorage.getStore();
    if (activeSource) {
      return (
        this.runtimeBinding?.runtimeProvider.forToolCall(activeSource) ??
        createNoopToolCallRuntimeContext(this.name, activeSource)
      );
    }

    return createNoopToolCallRuntimeContext(this.name);
  }
}

export class PublicNamedAgentTool extends AgentTool {
  schema: ToolInputSchemaBase;
  outSchema: z3.ZodType | z4.ZodType | undefined;
  name: string;
  description: string;

  constructor(
    private readonly delegate: AgentTool,
    publicName: string,
  ) {
    super();
    this.schema = delegate.schema;
    this.outSchema = delegate.outSchema;
    this.name = publicName;
    this.description = delegate.description;
  }

  protected async _call(
    arg: unknown,
    context: ToolCallRuntimeContext,
  ): Promise<ToolResponse> {
    return await this.delegate.invokeParsed(arg as never, context);
  }
}
