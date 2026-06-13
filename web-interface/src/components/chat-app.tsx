"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2 } from "lucide-react";

import { useChatSession } from "@/components/chat/use-chat-session";
import { Sidebar } from "@/components/chat/sidebar";
import { ChatHeader } from "@/components/chat/chat-header";
import {
    MessageEvent,
    type RenderableSessionEvent,
    type ToolRequestWithPluginEvents,
} from "@/components/chat/message-event";
import { ThinkingDots } from "@/components/chat/thinking-dots";
import { Composer } from "@/components/chat/composer";
import { PluginStatePanel } from "@/components/chat/plugin-state-panel";
import { type SessionEvent } from "@/lib/contracts";

type ToolCallPayload = Extract<
    SessionEvent,
    { type: "tool_request" }
>["payload"]["toolCalls"][number];

/**
 * Root chat application component.
 * Orchestrates the sidebar, header, message list, and composer.
 * All business logic lives in the useChatSession hook.
 */
export function ChatApp() {
    const session = useChatSession();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [pluginStatePanelOpen, setPluginStatePanelOpen] = useState(false);
    const conversationScrollRef = useRef<HTMLDivElement | null>(null);
    const renderEvents = useMemo(
        () => embedPluginEventsInToolRequests(session.activeEvents),
        [session.activeEvents],
    );

    /* Auto-scroll to bottom when new events arrive */
    useEffect(() => {
        const container = conversationScrollRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    }, [renderEvents, session.activeSessionId]);

    /* ── Loading screen ──────────────────────────────── */

    if (session.isLoading) {
        return (
            <main className="app-shell flex h-[100dvh] items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3">
                        <Bot className="h-10 w-10 text-muted-foreground animate-pulse-glow" />
                        <h1 className="text-2xl font-heading font-semibold text-foreground">
                            Agent Mimir
                        </h1>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Preparing your session...
                    </div>
                </div>
            </main>
        );
    }

    /* ── Main layout ─────────────────────────────────── */

    return (
        <main className="app-shell relative flex h-[100dvh] overflow-hidden bg-background">
            {/* Mobile overlay */}
            {sidebarOpen ? (
                <div
                    className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            ) : null}

            <Sidebar
                sessions={session.sessions}
                activeSessionId={session.activeSessionId}
                sidebarOpen={sidebarOpen}
                onSelectSession={(id) => {
                    session.setActiveSessionId(id);
                    if (window.innerWidth < 768) {
                        setSidebarOpen(false);
                    }
                }}
                onCreateSession={() => {
                    const name = window.prompt(
                        "Enter name for a new conversation:",
                        "New Conversation",
                    );
                    if (name === null) return;

                    const defaultAgent =
                        session.defaultAgentName ??
                        session.availableAgentNames[0];
                    let agentName = defaultAgent;
                    if (session.availableAgentNames.length > 1) {
                        const selected = window.prompt(
                            `Choose a principal agent:\n${session.availableAgentNames.join("\n")}`,
                            defaultAgent,
                        );
                        if (selected === null) return;
                        agentName = selected.trim() || defaultAgent;
                    }

                    session.createSession(name, agentName).catch((error) => {
                        session.setErrorMessage(
                            error instanceof Error
                                ? error.message
                                : "Failed to create session.",
                        );
                    });
                }}
                onDeleteSession={(id) => {
                    session.deleteSession(id).catch((error) => {
                        session.setErrorMessage(
                            error instanceof Error
                                ? error.message
                                : "Failed to delete session.",
                        );
                    });
                }}
            />

            <div className="relative flex flex-1 min-w-0">
                <div className="flex min-w-0 flex-1 flex-col">
                    <ChatHeader
                        sessionLabel={session.sessionLabel}
                        activeState={session.activeState}
                        sidebarOpen={sidebarOpen}
                        pluginStateCount={session.activePluginStates.length}
                        pluginStatePanelOpen={pluginStatePanelOpen}
                        onToggleSidebar={() => setSidebarOpen((o) => !o)}
                        onTogglePluginStatePanel={() =>
                            setPluginStatePanelOpen((o) => !o)
                        }
                        onSetContinuousMode={(enabled) => {
                            session
                                .setContinuousMode(enabled)
                                .catch((error) => {
                                    session.setErrorMessage(
                                        error instanceof Error
                                            ? error.message
                                            : "Could not toggle continuous mode.",
                                    );
                            });
                        }}
                        onResetSession={() => {
                            session.resetSession().catch((error) => {
                                session.setErrorMessage(
                                    error instanceof Error
                                        ? error.message
                                        : "Could not reset session.",
                                );
                            });
                        }}
                    />

                    {/* ── Chat messages ──────────────────────── */}
                    <div
                        ref={conversationScrollRef}
                        className="flex-1 overflow-y-auto overscroll-contain"
                    >
                        <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
                            {/* Empty state */}
                            {session.activeEvents.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-24 text-center">
                                    <Bot className="h-12 w-12 text-muted-foreground/40 mb-4" />
                                    <h2 className="text-lg font-heading font-semibold text-foreground/80 mb-1">
                                        {session.activeSessionId
                                            ? "Start a conversation"
                                            : "Create a conversation"}
                                    </h2>
                                    <p className="text-sm text-muted-foreground max-w-sm">
                                        {session.activeSessionId
                                            ? "Send a message to begin chatting with your agent."
                                            : "Click the + button in the sidebar to create your first conversation."}
                                    </p>
                                </div>
                            ) : null}

                            {renderEvents.map((event) => (
                                <MessageEvent
                                    key={
                                        (event as { messageId?: string })
                                            .messageId ?? event.id
                                    }
                                    event={event}
                                />
                            ))}

                            {/* Thinking animation */}
                            {session.isAgentThinking ? <ThinkingDots /> : null}
                        </div>
                    </div>

                    <Composer
                        activeSessionId={session.activeSessionId}
                        isSubmitting={session.isSubmitting}
                        hasPendingToolRequest={session.hasPendingToolRequest}
                        pendingNotificationCount={
                            session.pendingNotificationCount
                        }
                        errorMessage={session.errorMessage}
                        onSendMessage={(text, files) => {
                            session.sendMessage(text, files).catch((error) => {
                                session.setErrorMessage(
                                    error instanceof Error
                                        ? error.message
                                        : "Failed to send message.",
                                );
                            });
                        }}
                        onProcessNotifications={() => {
                            session.processNotifications().catch((error) => {
                                session.setErrorMessage(
                                    error instanceof Error
                                        ? error.message
                                        : "Notification processing failed.",
                                );
                            });
                        }}
                        onSubmitApproval={(action, feedback) => {
                            session
                                .submitApproval(action, feedback)
                                .catch((error) => {
                                    session.setErrorMessage(
                                        error instanceof Error
                                            ? error.message
                                            : "Approval failed.",
                                    );
                            });
                        }}
                        onClearError={() => session.setErrorMessage(null)}
                        onStopSession={() => {
                            session.stopSession().catch((error) => {
                                session.setErrorMessage(
                                    error instanceof Error
                                        ? error.message
                                        : "Stop failed.",
                                );
                            });
                        }}
                    />
                </div>

                <PluginStatePanel
                    sessionId={session.activeSessionId}
                    states={session.activePluginStates}
                    open={pluginStatePanelOpen}
                    onClose={() => setPluginStatePanelOpen(false)}
                />
            </div>
        </main>
    );
}

function embedPluginEventsInToolRequests(
    events: SessionEvent[],
): RenderableSessionEvent[] {
    const renderEvents: RenderableSessionEvent[] = [];
    const toolRequestsByCallId = new Map<string, ToolRequestWithPluginEvents>();
    const embeddedPluginEventIds = new Set<string>();

    for (const event of events) {
        if (event.type !== "tool_request") {
            renderEvents.push(event);
            continue;
        }

        const toolRequest: ToolRequestWithPluginEvents = {
            ...event,
            pluginEventsByToolCallId: {},
        };
        renderEvents.push(toolRequest);

        for (const call of event.payload.toolCalls) {
            for (const toolCallId of getRenderableToolCallIds(call)) {
                toolRequestsByCallId.set(toolCallId, toolRequest);
            }
        }
    }

    for (const event of events) {
        if (event.type !== "plugin_event") {
            continue;
        }

        const toolRequest = toolRequestsByCallId.get(event.toolCallId);
        if (!toolRequest) {
            continue;
        }

        const existingEvents =
            toolRequest.pluginEventsByToolCallId[event.toolCallId] ?? [];
        toolRequest.pluginEventsByToolCallId[event.toolCallId] = [
            ...existingEvents,
            event,
        ];
        embeddedPluginEventIds.add(event.id);
    }

    return renderEvents.filter(
        (event) =>
            event.type !== "plugin_event" ||
            !embeddedPluginEventIds.has(event.id),
    );
}

function getRenderableToolCallIds(call: ToolCallPayload): string[] {
    if (call.id) {
        return [call.id];
    }

    try {
        const parsed = JSON.parse(call.input);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .map((item) =>
                item && typeof item === "object"
                    ? (item as { id?: unknown }).id
                    : undefined,
            )
            .filter(
                (id): id is string => typeof id === "string" && id.length > 0,
            );
    } catch {
        return [];
    }
}
