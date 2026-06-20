"use client";

import type {
  ElicitationPropertySchema,
  ElicitationRequestedSchema,
} from "@/lib/contracts";

export type ElicitationFormValue = string | boolean | string[];

export function ElicitationFormFields({
  schema,
  values,
  errors = {},
  disabled,
  readOnly = false,
  onChange,
}: {
  schema: ElicitationRequestedSchema;
  values: Record<string, ElicitationFormValue>;
  errors?: Record<string, string>;
  disabled: boolean;
  readOnly?: boolean;
  onChange?: (name: string, value: ElicitationFormValue) => void;
}) {
  return (
    <div className="space-y-3">
      {Object.entries(schema.properties).map(([name, property]) => (
        <FormField
          key={name}
          name={name}
          schema={property}
          required={(schema.required ?? []).includes(name)}
          value={values[name]}
          error={errors[name]}
          disabled={disabled || readOnly}
          readOnly={readOnly}
          onChange={(value) => onChange?.(name, value)}
        />
      ))}
    </div>
  );
}

export function defaultElicitationFormValues(
  schema: ElicitationRequestedSchema,
): Record<string, ElicitationFormValue> {
  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => {
      if (property.type === "array") {
        return [name, property.default ?? []];
      }
      if (property.type === "boolean") {
        return [name, property.default ?? false];
      }
      if (property.type === "number" || property.type === "integer") {
        return [
          name,
          property.default === undefined ? "" : String(property.default),
        ];
      }
      return [name, property.default ?? ""];
    }),
  );
}

export function elicitationFormValuesFromContent(
  schema: ElicitationRequestedSchema,
  content: Record<string, unknown> | undefined,
): Record<string, ElicitationFormValue> {
  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => {
      const value = content?.[name];
      if (property.type === "array") {
        return [
          name,
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : [],
        ];
      }
      if (property.type === "boolean") {
        return [name, typeof value === "boolean" ? value : false];
      }
      if (property.type === "number" || property.type === "integer") {
        return [
          name,
          typeof value === "number" || typeof value === "string"
            ? String(value)
            : "",
        ];
      }
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}

export function validateAndNormalizeElicitationForm(
  schema: ElicitationRequestedSchema,
  values: Record<string, ElicitationFormValue>,
):
  | {
      ok: true;
      content: Record<string, unknown>;
    }
  | {
      ok: false;
      errors: Record<string, string>;
    } {
  const errors: Record<string, string> = {};
  const content: Record<string, unknown> = {};
  const required = new Set(schema.required ?? []);

  for (const [name, property] of Object.entries(schema.properties)) {
    const value = values[name];
    if (property.type === "boolean") {
      if (required.has(name) || value === true || value === false) {
        content[name] = value === true;
      }
      continue;
    }

    if (property.type === "array") {
      const selected = Array.isArray(value) ? value : [];
      if (required.has(name) && selected.length === 0) {
        errors[name] = "Select at least one option.";
        continue;
      }
      if (
        property.minItems !== undefined &&
        selected.length < property.minItems
      ) {
        errors[name] = `Select at least ${property.minItems}.`;
        continue;
      }
      if (
        property.maxItems !== undefined &&
        selected.length > property.maxItems
      ) {
        errors[name] = `Select at most ${property.maxItems}.`;
        continue;
      }
      if (selected.length > 0) {
        content[name] = selected;
      }
      continue;
    }

    const text = typeof value === "string" ? value : "";
    if (text.length === 0) {
      if (required.has(name)) {
        errors[name] = "Required.";
      }
      continue;
    }

    if (property.type === "number" || property.type === "integer") {
      const numberValue = Number(text);
      if (!Number.isFinite(numberValue)) {
        errors[name] = "Enter a number.";
        continue;
      }
      if (property.type === "integer" && !Number.isInteger(numberValue)) {
        errors[name] = "Enter an integer.";
        continue;
      }
      content[name] = numberValue;
      continue;
    }

    content[name] = text;
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, content };
}

function FormField({
  name,
  schema,
  required,
  value,
  error,
  disabled,
  readOnly,
  onChange,
}: {
  name: string;
  schema: ElicitationPropertySchema;
  required: boolean;
  value: ElicitationFormValue | undefined;
  error: string | undefined;
  disabled: boolean;
  readOnly: boolean;
  onChange: (value: ElicitationFormValue) => void;
}) {
  const label = schema.title ?? name;
  const description = schema.description;

  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-foreground">
        {label}
        {required ? <span className="text-emerald-300">*</span> : null}
      </span>
      {description ? (
        <span className="block text-[11px] text-muted-foreground">
          {description}
        </span>
      ) : null}
      <FieldControl
        name={name}
        schema={schema}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        onChange={onChange}
      />
      {error ? (
        <span className="block text-xs text-red-300">{error}</span>
      ) : null}
    </label>
  );
}

function FieldControl({
  name,
  schema,
  value,
  disabled,
  readOnly,
  onChange,
}: {
  name: string;
  schema: ElicitationPropertySchema;
  value: ElicitationFormValue | undefined;
  disabled: boolean;
  readOnly: boolean;
  onChange: (value: ElicitationFormValue) => void;
}) {
  if (schema.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        aria-readonly={readOnly}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-4 w-4 rounded border-border bg-background"
      />
    );
  }

  if (schema.type === "array") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="grid gap-1.5 sm:grid-cols-2">
        {arrayOptions(schema).map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/40 px-2 py-1.5 text-xs text-foreground"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              disabled={disabled}
              aria-readonly={readOnly}
              onChange={(event) => {
                const next = event.currentTarget.checked
                  ? [...selected, option.value]
                  : selected.filter((item) => item !== option.value);
                onChange(next);
              }}
              className="h-3.5 w-3.5 rounded border-border bg-background"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }

  if (schema.type === "string" && stringOptions(schema).length > 0) {
    return (
      <select
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        aria-readonly={readOnly}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground"
      >
        <option value="">Select...</option>
        {stringOptions(schema).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (schema.type === "number" || schema.type === "integer") {
    return (
      <input
        type="number"
        step={schema.type === "integer" ? 1 : "any"}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground"
      />
    );
  }

  return (
    <input
      type={inputTypeForString(schema)}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      readOnly={readOnly}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground"
      name={name}
    />
  );
}

function stringOptions(
  schema: Extract<ElicitationPropertySchema, { type: "string" }>,
) {
  if (schema.oneOf) {
    return schema.oneOf.map((option) => ({
      value: option.const,
      label: option.title ?? option.const,
    }));
  }
  if (schema.enum) {
    return schema.enum.map((option) => ({ value: option, label: option }));
  }
  return [];
}

function arrayOptions(
  schema: Extract<ElicitationPropertySchema, { type: "array" }>,
) {
  if ("enum" in schema.items) {
    return schema.items.enum.map((option) => ({
      value: option,
      label: option,
    }));
  }

  return schema.items.anyOf.map((option) => ({
    value: option.const,
    label: option.title ?? option.const,
  }));
}

function inputTypeForString(schema: ElicitationPropertySchema) {
  if (schema.type !== "string") return "text";
  if (schema.format === "email") return "email";
  if (schema.format === "uri") return "url";
  if (schema.format === "date") return "date";
  return "text";
}
