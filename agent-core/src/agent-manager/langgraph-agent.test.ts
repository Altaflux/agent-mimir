import { describe, expect, it } from "@jest/globals";
import { extractAllTextFromComplexResponse } from "../utils/format.js";
import type { AgentInput } from "./index.js";
import { materializeAgentInput } from "./langgraph-agent.js";

describe("materializeAgentInput", () => {
  it("keeps user messages unchanged with neutral runtime metadata", () => {
    const input = {
      type: "user_message" as const,
      message: {
        content: [{ type: "text" as const, text: "Hello" }],
        sharedFiles: [{ fileName: "notes.txt", url: "/tmp/notes.txt" }],
      },
    };
    const materialized = materializeAgentInput(input);

    expect(materialized.message.content).toEqual([
      { type: "text", text: "Hello" },
    ]);
    expect(materialized.additionalKwargs).toEqual({
      sharedFiles: [{ fileName: "notes.txt", url: "/tmp/notes.txt" }],
      runtimeInput: input,
    });
  });

  it("turns plugin notifications into explicit automated-notification prompts", () => {
    const input = {
      type: "plugin_notification" as const,
      notification: {
        notificationId: "notification-1",
        pluginId: "runtimeSmokeTest",
        pluginPrefix: "diagnostics",
        pluginNamespace: "diagnostics__runtimeSmokeTest",
        title: "Worker complete",
        summary: "Worker has a result.",
        content: {
          content: [{ type: "text", text: "result body" }],
          sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }],
        },
      },
    } satisfies AgentInput;
    const materialized = materializeAgentInput(input);

    const text = extractAllTextFromComplexResponse(
      materialized.message.content,
    );
    expect(text).toMatch(/process this pending plugin notification/i);
    expect(text).toMatch(/automated plugin notification/i);
    expect(text).toMatch(/not direct user-authored chat text/i);
    expect(text).toMatch(/Plugin: diagnostics \/ runtimeSmokeTest/);
    expect(text).toMatch(/Title: Worker complete/);
    expect(text).toMatch(/Summary: Worker has a result/);
    expect(text).toMatch(/result body/);
    expect(materialized.message.sharedFiles).toEqual([
      { fileName: "result.txt", url: "/tmp/result.txt" },
    ]);
    expect(materialized.additionalKwargs).toEqual({
      sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }],
      runtimeInput: input,
    });
  });
});
