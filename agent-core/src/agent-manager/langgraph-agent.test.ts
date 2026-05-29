import { describe, expect, it } from "@jest/globals";
import { extractAllTextFromComplexResponse } from "../utils/format.js";
import { materializeAgentInput } from "./langgraph-agent.js";

describe("materializeAgentInput", () => {
    it("keeps user messages unchanged with neutral runtime metadata", () => {
        const materialized = materializeAgentInput({
            type: "user_message",
            message: {
                content: [{ type: "text", text: "Hello" }],
                sharedFiles: [{ fileName: "notes.txt", url: "/tmp/notes.txt" }]
            }
        });

        expect(materialized.message.content).toEqual([{ type: "text", text: "Hello" }]);
        expect(materialized.additionalKwargs).toEqual({
            sharedFiles: [{ fileName: "notes.txt", url: "/tmp/notes.txt" }],
            runtimeInputKind: "user_message"
        });
    });

    it("turns plugin notifications into explicit automated-notification prompts", () => {
        const materialized = materializeAgentInput({
            type: "plugin_notification",
            notification: {
                notificationId: "notification-1",
                pluginName: "runtime-smoke-test",
                title: "Worker complete",
                message: "Worker has a result.",
                content: {
                    content: [{ type: "text", text: "result body" }],
                    sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }]
                }
            }
        });

        const text = extractAllTextFromComplexResponse(materialized.message.content);
        expect(text).toMatch(/process this pending plugin notification/i);
        expect(text).toMatch(/automated plugin notification/i);
        expect(text).toMatch(/not direct user-authored chat text/i);
        expect(text).toMatch(/Plugin: runtime-smoke-test/);
        expect(text).toMatch(/Title: Worker complete/);
        expect(text).toMatch(/result body/);
        expect(materialized.message.sharedFiles).toEqual([{ fileName: "result.txt", url: "/tmp/result.txt" }]);
        expect(materialized.additionalKwargs).toEqual({
            sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }],
            runtimeInputKind: "plugin_notification",
            runtimeNotification: {
                notificationId: "notification-1",
                pluginName: "runtime-smoke-test",
                title: "Worker complete",
                message: "Worker has a result."
            }
        });
    });
});
