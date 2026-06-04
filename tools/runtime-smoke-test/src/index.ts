import {
    AgentPlugin,
    type AgentSystemMessage,
    type PluginContext,
    type PluginFactory,
    type PluginRuntimeContext
} from "@mimir/agent-core/plugins";
import { AgentTool, type ToolCallRuntimeContext, type ToolResponse } from "@mimir/agent-core/tools";
import { z } from "zod/v4";

export class RuntimeSmokeTestPluginFactory implements PluginFactory {
    name = "runtime_smoke_test";

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new RuntimeSmokeTestPlugin(context.runtime);
    }
}

class RuntimeSmokeTestPlugin extends AgentPlugin {
    name = "Runtime Smoke Test";

    constructor(private readonly runtime: PluginRuntimeContext) {
        super();
    }
    async init(): Promise<void> {

        await this.runtime.events.emit({
            type: "STATE",
            markdown: "HOLA MUNDO"
        })
    }
    async getSystemMessages(): Promise<AgentSystemMessage> {
        return {
            content: [
                {
                    type: "text",
                    text:
                        "You have access to a runtime smoke-test tool. " +
                        "Use it only when the user asks to test plugin runtime events or notification inbox behavior."
                }
            ]
        };
    }

    async tools(): Promise<AgentTool[]> {
        return [
            new RuntimeSmokeTestTool(this.runtime)
        ];
    }
}

class RuntimeSmokeTestTool extends AgentTool {
    name = "runtime_smoke_test";
    description =
        "Emit sample plugin runtime events and enqueue a sample plugin notification. " +
        "Use this to test the UI event stream and manual notification processing flow.";

    schema = z.object({
        label: z.string().optional().describe("Short label for this smoke-test run."),
        steps: z.number().int().min(1).max(10).optional().describe("Number of progress events to emit."),
        delayMs: z.number().int().min(0).max(2000).optional().describe("Delay between progress events in milliseconds."),
        notificationTitle: z.string().optional().describe("Title for the queued notification."),
        notificationSummary: z.string().optional().describe("Optional notification summary."),
        notificationContent: z.string().optional().describe("Content the principal agent should receive when notifications are processed.")
    });

    constructor(private readonly runtime: PluginRuntimeContext) {
        super();
    }

    protected async _call(input: z.output<this["schema"]>, context: ToolCallRuntimeContext): Promise<ToolResponse> {
        const label = input.label?.trim() || "runtime smoke test";
        const steps = input.steps ?? 3;
        const delayMs = input.delayMs ?? 250;
        const notificationTitle = input.notificationTitle?.trim() || `Smoke test complete: ${label}`;
        const notificationSummary = input.notificationSummary?.trim() || "A dummy runtime notification was queued.";
        const notificationContent = input.notificationContent?.trim() ||
            `The runtime smoke-test tool finished the run named "${label}". ` +
            "This notification exists only to verify manual inbox processing.";

        await context.emitEvent({
            body: {
                type: "status",
                title: "Runtime smoke test",
                message: `Starting "${label}".`
            }
        });
        await context.emitEvent({
            body: {
                type: "message",
                title: "Title:::Message from the tool call",
                message: `Message:::Starting "${label}".`
            }
        });

        for (let index = 1; index <= steps; index += 1) {
            await wait(delayMs);
            await context.emitEvent({
                body: {
                    type: "progress",
                    label,
                    message: `Step ${index} of ${steps}`,
                    current: index,
                    total: steps
                }
            });


            await this.runtime.events.emit({
                type: "STATE",
                markdown:
                    `## Runtime smoke test\n\n` +
                    `Current run: **${label}**\n\n` +
                    `Progress: ${index}/${steps}\n\n` +
                    `![Runtime smoke state](asset://smoke-state)`,
                assets: [
                    {
                        id: "smoke-state",
                        fileName: "runtime-smoke-state.svg",
                        contentType: "image/svg+xml",
                        bytes: Buffer.from(
                            `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180" viewBox="0 0 640 180">` +
                            `<rect width="640" height="180" rx="18" fill="#0f172a"/>` +
                            `<rect x="24" y="24" width="592" height="132" rx="12" fill="#0e7490" opacity="0.25"/>` +
                            `<text x="40" y="78" fill="#e2e8f0" font-size="28" font-family="Arial, sans-serif">Runtime smoke test</text>` +
                            `<text x="40" y="120" fill="#67e8f9" font-size="20" font-family="Arial, sans-serif">${escapeSvg(label)} complete</text>` +
                            `</svg>`
                        )
                    }
                ]
            });


        }

        await context.emitEvent({
            body: {
                type: "message",
                title: "Runtime smoke test",
                message: `Finished "${label}" and queued a notification.`
            }
        });

        await this.runtime.events.emit({
            type: "LOG",
            text: `Runtime smoke test "${label}" emitted ${steps} tool events.`
        });


        const notification = await this.runtime.notifications.enqueue({
            title: notificationTitle,
            summary: notificationSummary,
            deduplicationId: "423654",
            content: {
                content: [
                    {
                        type: "text",
                        text: notificationContent
                    }
                ]
            }
        });
        return [
            {
                type: "text",
                text:
                    `Runtime smoke test finished.\n` +
                    `Notification ID: ${notification.id}\n` +
                    `Title: ${notification.title}\n` +
                    "Use the pending notification Process button to route it to the principal agent."
            }
        ];
    }
}

async function wait(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
        return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function escapeSvg(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
