import { describe, expect, it } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import { readHydrationEvents } from "./hydration.js";

describe("readHydrationEvents", () => {
    it("keeps hydrated user message ids separate from input content", async () => {
        const checkpointer = {
            async *list() {
                yield {
                    config: {
                        configurable: {
                            checkpoint_id: "checkpoint-1"
                        }
                    },
                    checkpoint: {
                        ts: "2026-05-28T10:00:00.000Z",
                        channel_values: {
                            requestAttributes: {
                                runtimeTaskId: "task-1"
                            },
                            messages: [
                                new HumanMessage({
                                    id: "human-message-1",
                                    content: "Hello"
                                })
                            ]
                        }
                    }
                };
            }
        };

        const events = await readHydrationEvents({
            sessionId: "session-1",
            name: "Principal",
            checkpointer: checkpointer as never
        });

        expect(events).toHaveLength(1);
        const event = events[0]!;
        expect(event.type).toBe("userMessage");
        if (event.type !== "userMessage") {
            return;
        }
        expect(event.messageId).toBe("human-message-1");
        expect(event.requestAttributes).toEqual({ runtimeTaskId: "task-1" });
        expect(event.content).toEqual({
            content: [{ type: "text", text: "Hello" }],
            sharedFiles: []
        });
        expect("id" in event.content).toBe(false);
    });

    it("hydrates plugin notification origin from message metadata when request attributes are missing", async () => {
        const checkpointer = {
            async *list() {
                yield {
                    config: {
                        configurable: {
                            checkpoint_id: "checkpoint-1"
                        }
                    },
                    checkpoint: {
                        ts: "2026-05-28T10:00:00.000Z",
                        channel_values: {
                            requestAttributes: {},
                            messages: [
                                new HumanMessage({
                                    id: "human-message-1",
                                    content: "Notification body",
                                    additional_kwargs: {
                                        runtimeInputKind: "plugin_notification",
                                        runtimeNotification: {
                                            notificationId: "notification-1",
                                            pluginName: "runtime-smoke-test",
                                            title: "Worker complete"
                                        }
                                    }
                                })
                            ]
                        }
                    }
                };
            }
        };

        const events = await readHydrationEvents({
            sessionId: "session-1",
            name: "Principal",
            checkpointer: checkpointer as never
        });

        expect(events).toHaveLength(1);
        const event = events[0]!;
        expect(event.type).toBe("userMessage");
        if (event.type !== "userMessage") {
            return;
        }
        expect(event.requestAttributes).toEqual({
            runtimeMessageOrigin: {
                type: "plugin_notification",
                notificationId: "notification-1",
                pluginName: "runtime-smoke-test",
                title: "Worker complete",
                message: undefined
            }
        });
    });
});
