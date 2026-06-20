// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@/lib/contracts";
import { MessageEvent } from "./message-event";

describe("MessageEvent", () => {
  it("renders accepted form elicitation responses as filled read-only fields", () => {
    const event: Extract<
      SessionEvent,
      { type: "plugin_elicitation_response" }
    > = {
      id: "elicitation-response-event-1",
      sessionId: "session-1",
      timestamp: "2026-05-28T10:03:00.000Z",
      type: "plugin_elicitation_response",
      elicitationRequestId: "elicitation-request-1",
      pluginInstanceId: "plugin-instance-1",
      pluginId: "runtimeSmokeTest",
      pluginNamespace: "runtimeSmokeTest",
      agentName: "Principal",
      request: {
        mode: "form",
        message: "Pick a value.",
        requestedSchema: {
          type: "object",
          properties: {
            username: {
              type: "string",
              title: "Username",
            },
            age: {
              type: "integer",
              title: "Age",
            },
          },
          required: ["username"],
        },
      },
      action: "accept",
      content: {
        username: "octocat",
        age: 30,
      },
    };

    render(<MessageEvent event={event} />);

    expect(screen.getByText("Username")).toBeTruthy();
    expect(screen.getByText("Age")).toBeTruthy();
    const username = screen.getByDisplayValue("octocat") as HTMLInputElement;
    const age = screen.getByDisplayValue("30") as HTMLInputElement;
    expect(username.disabled).toBe(true);
    expect(age.disabled).toBe(true);
    expect(screen.queryByText(/"username"/)).toBeNull();
  });
});
