import { describe, expect, it } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import { langChainHumanMessageToMimirHumanMessage } from "./utils.js";

describe("langChainHumanMessageToMimirHumanMessage", () => {
    it("returns plugin notification turns as a distinct hook input kind", () => {
        const message = new HumanMessage({
            content: "Notification body",
            additional_kwargs: {
                sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }],
                runtimeInputKind: "plugin_notification",
                runtimeNotification: {
                    notificationId: "notification-1",
                    pluginName: "runtime-smoke-test",
                    title: "Worker complete",
                    message: "Worker has a result."
                }
            }
        });

        expect(langChainHumanMessageToMimirHumanMessage(message)).toEqual({
            type: "PLUGIN_NOTIFICATION",
            notificationId: "notification-1",
            pluginName: "runtime-smoke-test",
            title: "Worker complete",
            message: "Worker has a result.",
            content: [{ type: "text", text: "Notification body" }],
            sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }]
        });
    });
});
