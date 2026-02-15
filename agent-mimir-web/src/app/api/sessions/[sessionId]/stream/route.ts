import { SessionEvent } from "@/lib/contracts";
import { jsonError } from "@/server/runtime/http";
import { sessionManager } from "@/server/runtime/session-manager";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15000;

function encodeSseChunk(payload: SessionEvent): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(
    request: Request,
    context: {
        params: Promise<{ sessionId: string }>;
    }
) {
    try {
        const { sessionId } = await context.params;
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const emitRaw = (chunk: string) => {
                    controller.enqueue(encoder.encode(chunk));
                };

                const emitEvent = (event: SessionEvent) => {
                    emitRaw(encodeSseChunk(event));
                };

                const subscription = sessionManager.subscribe(sessionId, (event) => {
                    emitEvent(event);
                });

                emitEvent({
                    id: crypto.randomUUID(),
                    sessionId,
                    timestamp: new Date().toISOString(),
                    type: "state_changed",
                    state: subscription.state
                });

                for (const event of subscription.backlog) {
                    emitEvent(event);
                }

                const heartbeat = setInterval(() => {
                    emitRaw(`: heartbeat ${Date.now()}\n\n`);
                }, HEARTBEAT_MS);

                const close = () => {
                    clearInterval(heartbeat);
                    subscription.unsubscribe();
                    try {
                        controller.close();
                    } catch {
                        return;
                    }
                };

                request.signal.addEventListener("abort", close, { once: true });
            }
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                Connection: "keep-alive",
                "Cache-Control": "no-cache, no-transform"
            }
        });
    } catch (error) {
        return jsonError(error);
    }
}
