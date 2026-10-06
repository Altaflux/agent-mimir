import { describe, expect, it } from "@jest/globals";
import { z as z3 } from "zod/v3";
import { z as z4 } from "zod/v4";
import { createPublicPluginTool } from "../agent-manager/plugin-config.js";
import {
  AgentTool,
  createStandaloneToolCallRuntimeContext,
  type ToolInputSchemaBase,
} from "./index.js";

class CapturingTool extends AgentTool<ToolInputSchemaBase, unknown, unknown> {
  name = "web_search";
  description = "Capture parsed input.";
  seen: unknown[] = [];
  error: Error | undefined;
  constructor(public schema: ToolInputSchemaBase) {
    super();
  }
  protected async _call(input: unknown) {
    if (this.error) throw this.error;
    this.seen.push(input);
    return [
      { type: "text" as const, text: "A source excerpt: https://example.org" },
    ];
  }
}
const context = createStandaloneToolCallRuntimeContext("test");

describe("AgentTool schema invocation", () => {
  it("passes JSON Schema input through the public plugin wrapper", async () => {
    const tool = new CapturingTool({
      type: "object",
      properties: { objective: { type: "string" } },
      required: ["objective"],
    });
    const wrapped = createPublicPluginTool("parallel__mcpClient", tool);
    const input = { objective: "Find documentation" };
    expect(await wrapped.invoke(input, context)).toEqual([
      { type: "text", text: "A source excerpt: https://example.org" },
    ]);
    expect(tool.seen).toEqual([input]);
    expect(wrapped.name).toBe("parallel__mcpClient__web_search");
  });

  it.each([
    z3.object({ value: z3.string().trim() }),
    z4.object({ value: z4.string().trim() }),
  ])("keeps Zod parsing, transforms and rejection", async (schema) => {
    const tool = new CapturingTool(schema);
    const wrapped = createPublicPluginTool("test", tool);
    await wrapped.invoke({ value: " hello " }, context);
    await expect(wrapped.invoke({ value: 42 }, context)).rejects.toThrow();
    expect(tool.seen).toEqual([{ value: "hello" }]);
  });

  it("propagates delegated JSON Schema tool errors", async () => {
    const tool = new CapturingTool({ type: "object" });
    tool.error = new Error("Remote validation rejected input");
    const wrapped = createPublicPluginTool("mcpClient", tool);
    await expect(wrapped.invoke({}, context)).rejects.toThrow(
      "Remote validation rejected input",
    );
  });
});
