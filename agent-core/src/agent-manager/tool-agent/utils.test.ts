import { describe, expect, it } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import { langChainHumanMessageToMimirHumanMessage } from "./utils.js";

describe("langChainHumanMessageToMimirHumanMessage", () => {
  it("returns plugin notification turns as a distinct hook input kind", () => {
    const message = new HumanMessage({
      content: "Notification body",
      additional_kwargs: {
        sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }],
        runtimeInput: {
          type: "plugin_notification",
          notification: {
            notificationId: "notification-1",
            pluginId: "runtimeSmokeTest",
            pluginPrefix: "diagnostics",
            pluginNamespace: "diagnostics__runtimeSmokeTest",
            title: "Worker complete",
            summary: "Worker has a result.",
            content: {
              content: [
                { type: "text", text: "Original notification content" },
              ],
            },
          },
        },
      },
    });

    expect(langChainHumanMessageToMimirHumanMessage(message)).toEqual({
      type: "PLUGIN_NOTIFICATION",
      notificationId: "notification-1",
      pluginId: "runtimeSmokeTest",
      pluginPrefix: "diagnostics",
      pluginNamespace: "diagnostics__runtimeSmokeTest",
      title: "Worker complete",
      summary: "Worker has a result.",
      content: [{ type: "text", text: "Notification body" }],
      sharedFiles: [{ fileName: "result.txt", url: "/tmp/result.txt" }],
    });
  });
});
