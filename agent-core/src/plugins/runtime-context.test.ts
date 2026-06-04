import { describe, expect, it } from "@jest/globals";
import type { AgentWorkspace } from "../agent-manager/index.js";
import {
    NOOP_PLUGIN_RUNTIME_PROVIDER,
    createPluginContext,
    type PluginRuntimeContext,
    type PluginRuntimeProvider
} from "./index.js";
import { AgentTool, type ToolCallRuntimeContext } from "../tools/index.js";
import { z } from "zod/v4";

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
        const notification = await runtime.notifications.enqueue({
            title: "No-op notification",
            content: {
                content: [{ type: "text", text: "No-op content" }]
            }
        });

        expect(notification.pluginName).toBe("unit-test");
        expect(notification.title).toBe("No-op notification");
        expect("emitEvent" in runtime).toBe(false);
        await Promise.resolve(runtime.events.emit({ type: "LOG", text: "hello" }));
    });

    it("builds plugin contexts with plugin-specific runtime contexts", () => {
        const expectedRuntime: PluginRuntimeContext = {
            notifications: {
                enqueue: async (input) => ({
                    id: "notification-1",
                    pluginName: "capturing",
                    agentName: "Agent",
                    createdAt: 1767225600000,
                    title: input.title,
                    summary: input.summary,
                    content: input.content
                })
            },
            events: {
                emit: () => {
                    return;
                }
            }
        };
        const requestedPluginNames: string[] = [];
        const pluginRuntime: PluginRuntimeProvider = {
            forPlugin(pluginName: string) {
                requestedPluginNames.push(pluginName);
                return pluginName === "capturing"
                    ? expectedRuntime
                    : NOOP_PLUGIN_RUNTIME_PROVIDER.forPlugin(pluginName);
            },
            forToolCall(pluginName, source) {
                return NOOP_PLUGIN_RUNTIME_PROVIDER.forToolCall(pluginName, source);
            }
        };
        const workspace = createWorkspace();

        const context = createPluginContext(workspace, pluginRuntime, "capturing");

        expect(requestedPluginNames).toContain("capturing");
        expect(context.workspace).toBe(workspace);
        expect(context.runtime).toBe(expectedRuntime);
    });

    it("passes tool call runtime contexts to AgentTool implementations", async () => {
        const tool = new CapturingTool();
        const response = await tool.invoke(
            {
                value: "hello"
            },
            {
                toolCallId: "tool-call-1",
                toolName: "capturing_tool",
                emitEvent: () => {
                    return;
                }
            }
        );

        expect(response).toEqual([{ type: "text", text: "hello" }]);
        expect(tool.context).toMatchObject({
            toolCallId: "tool-call-1",
            toolName: "capturing_tool"
        });
    });

    it("uses bound plugin runtime providers for tool-scoped event emission", async () => {
        const emitted: Array<{
            pluginName: string;
            context: Pick<ToolCallRuntimeContext, "toolCallId" | "toolName">;
            input: Parameters<ToolCallRuntimeContext["emitEvent"]>[0];
        }> = [];
        const pluginRuntime: PluginRuntimeProvider = {
            forPlugin(pluginName: string) {
                return NOOP_PLUGIN_RUNTIME_PROVIDER.forPlugin(pluginName);
            },
            forToolCall(pluginName, source) {
                return {
                    ...source,
                    emitEvent(input) {
                        emitted.push({
                            pluginName,
                            context: source,
                            input
                        });
                    }
                };
            }
        };
        const tool = new EventEmittingTool().bindPluginRuntime("event-plugin", pluginRuntime);

        await tool.invoke(
            {
                value: "hello"
            },
            {
                toolCallId: "tool-call-1",
                toolName: "event_tool"
            }
        );

        expect(emitted).toEqual([
            {
                pluginName: "event-plugin",
                context: {
                    toolCallId: "tool-call-1",
                    toolName: "event_tool"
                },
                input: {
                    body: {
                        type: "status",
                        message: "hello"
                    }
                }
            }
        ]);
    });
});

class CapturingTool extends AgentTool {
    name = "capturing_tool";
    description = "Captures tool runtime context.";
    schema = z.object({
        value: z.string()
    });
    context: ToolCallRuntimeContext | undefined;

    protected async _call(input: z.output<this["schema"]>, context: ToolCallRuntimeContext) {
        this.context = context;
        return [{ type: "text" as const, text: input.value }];
    }
}

class EventEmittingTool extends AgentTool {
    name = "event_tool";
    description = "Emits a tool-scoped runtime event.";
    schema = z.object({
        value: z.string()
    });

    protected async _call(input: z.output<this["schema"]>, context: ToolCallRuntimeContext) {
        await context.emitEvent({
            body: {
                type: "status",
                message: input.value
            }
        });
        return [{ type: "text" as const, text: input.value }];
    }
}
