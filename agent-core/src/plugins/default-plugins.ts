import { InputAgentMessage } from "../agent-manager/index.js";
import {
  AgentTool,
  type ToolCallRuntimeContext,
  type ToolResponse,
} from "../tools/index.js";
import {
  AgentPlugin,
  type ElicitationPropertySchema,
  PluginFactory,
  PluginContext,
  AdditionalContent,
} from "./index.js";
import { z } from "zod/v4";

const askUserFieldOptionSchema = z.object({
  value: z.string().min(1),
  title: z.string().optional(),
});

const askUserFieldSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .describe(
      "Machine-readable field name. Use letters, numbers, and underscores; it must not start with a number.",
    ),
  title: z
    .string()
    .optional()
    .describe("Short user-facing label for this field."),
  description: z
    .string()
    .optional()
    .describe("Optional helper text shown with this field."),
  type: z
    .enum([
      "text",
      "number",
      "integer",
      "boolean",
      "single_select",
      "multi_select",
    ])
    .optional()
    .describe("Field input type. Defaults to text."),
  required: z
    .boolean()
    .optional()
    .describe("Whether the user must answer this field."),
  options: z
    .array(askUserFieldOptionSchema)
    .optional()
    .describe(
      "Options for single_select or multi_select fields. Use value for the returned value and title for the display label.",
    ),
});

const askUserSchema = z.object({
  message: z
    .string()
    .min(1)
    .describe(
      "Clear message shown to the user explaining what information is needed and why.",
    ),
  fields: z
    .array(askUserFieldSchema)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "Optional structured fields to request. If omitted, a single required text field named answer is used.",
    ),
});

type AskUserToolInput = z.output<typeof askUserSchema>;
type AskUserField = z.output<typeof askUserFieldSchema>;
type AskUserFieldOption = z.output<typeof askUserFieldOptionSchema>;

export class DefaultPluginFactory implements PluginFactory {
  pluginId = "core";

  async create(_context: PluginContext): Promise<AgentPlugin> {
    return new DefaultPlugin();
  }
}

class DefaultPlugin extends AgentPlugin {
  async additionalMessageContent(
    message: InputAgentMessage,
  ): Promise<AdditionalContent[]> {
    return [
      {
        displayOnCurrentMessage: true,
        saveToChatHistory: true,
        content: [
          {
            type: "text",
            text: `The current time is: ${new Date().toISOString()}`,
          },
        ],
      },
    ];
  }

  async tools(): Promise<AgentTool[]> {
    return [new AskUserTool()];
  }
}

class AskUserTool extends AgentTool {
  name = "ask_user";
  description =
    "Ask the user for clarification or missing non-sensitive information while continuing a task. " +
    "Use this when a direct answer from the user would unblock the work. Do not use it to request passwords, API keys, payment details, or other sensitive data.";

  schema = askUserSchema;

  protected async _call(
    input: AskUserToolInput,
    context: ToolCallRuntimeContext,
  ): Promise<ToolResponse> {
    const fields =
      input.fields && input.fields.length > 0
        ? input.fields
        : [
            {
              name: "answer",
              title: "Answer",
              type: "text" as const,
              required: true,
            },
          ];

    const response = await context.elicitation.create({
      mode: "form",
      message: input.message,
      requestedSchema: {
        type: "object",
        properties: Object.fromEntries(
          fields.map((field) => [
            field.name,
            this.toElicitationPropertySchema(field),
          ]),
        ),
        required: fields
          .filter((field) => field.required ?? true)
          .map((field) => field.name),
      },
    });

    if (response.action === "accept") {
      return [
        {
          type: "text",
          text:
            "The user answered the elicitation request.\n\n" +
            JSON.stringify(response.content ?? {}, null, 2),
        },
      ];
    }

    return [
      {
        type: "text",
        text: `The user ${response.action}ed the elicitation request. Continue without that information or ask a different question if still necessary.`,
      },
    ];
  }

  private toElicitationPropertySchema(
    field: AskUserField,
  ): ElicitationPropertySchema {
    const base = {
      title: field.title,
      description: field.description,
    };
    const type = field.type ?? "text";

    if (type === "boolean") {
      return {
        ...base,
        type: "boolean" as const,
      };
    }

    if (type === "number" || type === "integer") {
      return {
        ...base,
        type,
      };
    }

    if (type === "single_select") {
      const options = this.requireOptions(field);
      return {
        ...base,
        type: "string" as const,
        oneOf: options.map((option) => ({
          const: option.value,
          title: option.title ?? option.value,
        })),
      };
    }

    if (type === "multi_select") {
      const options = this.requireOptions(field);
      return {
        ...base,
        type: "array" as const,
        items: {
          anyOf: options.map((option) => ({
            const: option.value,
            title: option.title ?? option.value,
          })),
        },
      };
    }

    return {
      ...base,
      type: "string" as const,
    };
  }

  private requireOptions(field: AskUserField): AskUserFieldOption[] {
    if (!field.options || field.options.length === 0) {
      throw new Error(
        `Field "${field.name}" uses ${field.type} and must provide options.`,
      );
    }

    return field.options;
  }
}
