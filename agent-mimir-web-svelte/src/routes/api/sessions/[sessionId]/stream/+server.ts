import crypto from "crypto";
import type { SessionEvent } from "@/lib/contracts";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError } from "@/lib/server/http";

const HEARTBEAT_MS = 15000;

function encodeSseChunk(payload: SessionEvent): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

export const GET = async ({ params, request }: { params: { sessionId: string }; request: Request }) => {
    try {
        const { sessionId } = params;
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
};
