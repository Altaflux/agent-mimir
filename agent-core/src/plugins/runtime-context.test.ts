import { describe, expect, it } from "@jest/globals";
import type { AgentWorkspace } from "../agent-manager/index.js";
import {
    NOOP_PLUGIN_RUNTIME_PROVIDER,
    createPluginContext,
    type PluginRuntimeContext,
    type PluginRuntimeProvider
} from "./index.js";

function createWorkspace(): AgentWorkspace {
    return {
        workingDirectory: "C:/tmp/mimir-test",
        rootDirectory: "C:/tmp/mimir-test",
        async listFiles() {
            return [];
        },
        async loadFileToWorkspace() {
            return;
        },
        async reset() {
            return;
        },
        async getUrlForFile() {
            return undefined;
        },
        async fileAsBuffer() {
            return undefined;
        }
    };
}

describe("Plugin runtime context", () => {
    it("provides a noop runtime for standalone agent creation", async () => {
        const runtime = NOOP_PLUGIN_RUNTIME_PROVIDER.forPlugin("unit-test");
        await runtime.emitEvent({
            body: {
                type: "status",
                message: "No-op event"
            }
        });

        const notification = await runtime.notifications.enqueue({
            title: "No-op notification",
            content: {
                content: [{ type: "text", text: "No-op content" }]
            }
        });

        expect(notification.pluginName).toBe("unit-test");
        expect(notification.title).toBe("No-op notification");
        expect(notification.read).toBe(false);
    });

    it("builds plugin contexts with plugin-specific runtime contexts", () => {
        const expectedRuntime: PluginRuntimeContext = {
            emitEvent: () => {
                return;
            },
            notifications: {
                enqueue: async (input) => ({
                    id: "notification-1",
                    pluginName: "capturing",
                    agentName: "Agent",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    title: input.title,
                    message: input.message,
                    content: input.content,
                    read: false
                })
            }
        };
        const requestedPluginNames: string[] = [];
        const pluginRuntime: PluginRuntimeProvider = {
            forPlugin(pluginName: string) {
                requestedPluginNames.push(pluginName);
                return pluginName === "capturing"
                    ? expectedRuntime
                    : NOOP_PLUGIN_RUNTIME_PROVIDER.forPlugin(pluginName);
            }
        };
        const workspace = createWorkspace();

        const context = createPluginContext(workspace, pluginRuntime, "capturing");

        expect(requestedPluginNames).toContain("capturing");
        expect(context.workspace).toBe(workspace);
        expect(context.runtime).toBe(expectedRuntime);
    });
});
