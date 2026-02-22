import { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph";
import { AgentHydrationEvent, AgentMessageToolRequest, SharedFile } from "../agent-manager/index.js";
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { lCmessageContentToContent } from "../agent-manager/message-utils.js";
import { extractAllTextFromComplexResponse } from "./format.js";
import { v4 } from "uuid";

export async function readHydrationEvents(args: { sessionId: string; name: string, checkpointer: BaseCheckpointSaver }): Promise<AgentHydrationEvent[]> {

    const threadId = `${args.sessionId}#${args.name}`;
    //// Using Checkpointer
    const checkpointTuples: CheckpointTuple[] = [];
    const checkpointTuplesAsyncGenerator = (args.checkpointer).list({
        configurable: {
            thread_id: threadId
        }
    });
    for await (const snapshot of checkpointTuplesAsyncGenerator) {
        checkpointTuples.push(snapshot);
    }

    checkpointTuples.reverse();
    const seenMessageIds = new Set<string>();
    const events: AgentHydrationEvent[] = [];

    for (const snapshot of checkpointTuples) {
        const values = (snapshot.checkpoint?.channel_values ?? {}) as Record<string, any>;
        const messages = (values.messages ?? []) as BaseMessage[];
        const checkpointId =
            String(snapshot.config?.configurable?.checkpoint_id ?? snapshot.metadata?.step ?? "unknown-checkpoint");
        const timestamp = snapshot.checkpoint?.ts ?? new Date().toISOString();
        const responseAttributes = (values.responseAttributes ?? {}) as Record<string, any>;
        const requestAttributes = (values.requestAttributes ?? {}) as Record<string, any>;

        for (let idx = 0; idx < messages.length; idx += 1) {
            const message = messages[idx]!;
            const messageId = message.id ?? `${checkpointId}:${idx}:${message.constructor?.name ?? "message"}`;
            if (seenMessageIds.has(messageId)) {
                continue;
            }
            seenMessageIds.add(messageId);

            if (HumanMessage.isInstance(message)) {
                const content = lCmessageContentToContent(message.contentBlocks);
                const messageText = extractAllTextFromComplexResponse(content).trim();
                const sharedFiles = (message.additional_kwargs?.shared_files as SharedFile[] | undefined) ?? [];
                const isForwardedMessage = messageText.startsWith("This message is from ");
                const isSyntheticMessage = typeof message.id === "string" && message.id.startsWith("do-not-render-");

                if (isForwardedMessage || isSyntheticMessage) {
                    continue;
                }

                if (messageText.length === 0 && sharedFiles.length === 0) {
                    continue;
                }

                events.push({
                    type: "userMessage",
                    timestamp,
                    checkpointId,
                    content: {
                        content,
                        sharedFiles
                    },
                    requestAttributes: requestAttributes
                });
                continue;
            }

            if (ToolMessage.isInstance(message)) {
                const response = lCmessageContentToContent(message.contentBlocks);
                events.push({
                    type: "toolResponse",
                    timestamp,
                    checkpointId,
                    output: {
                        type: "toolResponse",
                        id: message.tool_call_id ?? message.id ?? v4(),
                        toolResponse: {
                            id: message.tool_call_id ?? message.id ?? undefined,
                            name: message.name ?? "Unknown",
                            response
                        }
                    }
                });
                continue;
            }

            if (!AIMessage.isInstance(message)) {
                continue;
            }

            const content = lCmessageContentToContent(message.contentBlocks);
            const sharedFiles = (message.additional_kwargs?.shared_files as SharedFile[] | undefined) ?? [];
            const outputId = message.id ?? v4();
            if ((message.tool_calls?.length ?? 0) > 0) {
                events.push({
                    type: "toolRequest",
                    timestamp,
                    checkpointId,
                    output: {
                        id: outputId,
                        content,
                        sharedFiles,
                        toolCalls: message.tool_calls!.map((toolCall) => ({
                            id: toolCall.id,
                            toolName: toolCall.name ?? "Unknown",
                            input: JSON.stringify(toolCall.args ?? {}, null, 2)
                        }))
                    } satisfies AgentMessageToolRequest,
                    responseAttributes
                });
                continue;
            }

            events.push({
                type: "agentResponse",
                timestamp,
                checkpointId,
                output: {
                    id: outputId,
                    content,
                    sharedFiles
                },
                responseAttributes
            });
        }
    }

    return events;
}
