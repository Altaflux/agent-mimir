"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Zap } from "lucide-react";

import { useChatSession } from "@/components/chat/use-chat-session";
import { Sidebar } from "@/components/chat/sidebar";
import { ChatHeader } from "@/components/chat/chat-header";
import { MessageEvent } from "@/components/chat/message-event";
import { ThinkingDots } from "@/components/chat/thinking-dots";
import { Composer } from "@/components/chat/composer";
import { CollapsibleSection } from "@/components/chat/shared";
import { SessionEvent } from "@/lib/contracts";

/**
 * Root chat application component.
 * Orchestrates the sidebar, header, message list, and composer.
 * All business logic lives in the useChatSession hook.
 */
export function ChatApp() {
    const session = useChatSession();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const conversationScrollRef = useRef<HTMLDivElement | null>(null);

    /* Auto-scroll to bottom when new events arrive */
    useEffect(() => {
        const container = conversationScrollRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    }, [session.activeEvents, session.activeSessionId]);

    /* ── Loading screen ──────────────────────────────── */

    if (session.isLoading) {
        return (
            <main className="app-shell flex h-[100dvh] items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3">
                        <Bot className="h-10 w-10 text-muted-foreground animate-pulse-glow" />
                        <h1 className="text-2xl font-heading font-semibold text-foreground">Agent Mimir</h1>
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
                    const name = window.prompt("Enter name for a new conversation:", "New Conversation");
                    if (name === null) return;

                    session.createSession(name).catch((error) => {
                        session.setErrorMessage(error instanceof Error ? error.message : "Failed to create session.");
                    });
                }}
                onDeleteSession={(id) => {
                    session.deleteSession(id).catch((error) => {
                        session.setErrorMessage(error instanceof Error ? error.message : "Failed to delete session.");
                    });
                }}
            />

            <div className="flex flex-1 flex-col min-w-0">
                <ChatHeader
                    sessionLabel={session.sessionLabel}
                    activeState={session.activeState}
                    sidebarOpen={sidebarOpen}
                    onToggleSidebar={() => setSidebarOpen((o) => !o)}
                    onSetContinuousMode={(enabled) => {
                        session.setContinuousMode(enabled).catch((error) => {
                            session.setErrorMessage(error instanceof Error ? error.message : "Could not toggle continuous mode.");
                        });
                    }}
                    onSetActiveAgent={(agentName) => {
                        session.setActiveAgent(agentName).catch((error) => {
                            session.setErrorMessage(error instanceof Error ? error.message : "Could not change agent.");
                        });
                    }}
                    onResetSession={() => {
                        session.resetSession().catch((error) => {
                            session.setErrorMessage(error instanceof Error ? error.message : "Could not reset session.");
                        });
                    }}
                />

                {/* ── Chat messages ──────────────────────── */}
                <div ref={conversationScrollRef} className="flex-1 overflow-y-auto overscroll-contain">
                    <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
                        {/* Empty state */}
                        {session.activeEvents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center">
                                <Bot className="h-12 w-12 text-muted-foreground/40 mb-4" />
                                <h2 className="text-lg font-heading font-semibold text-foreground/80 mb-1">
                                    {session.activeSessionId ? "Start a conversation" : "Create a conversation"}
                                </h2>
                                <p className="text-sm text-muted-foreground max-w-sm">
                                    {session.activeSessionId
                                        ? "Send a message to begin chatting with your agent."
                                        : "Click the + button in the sidebar to create your first conversation."}
                                </p>
                            </div>
                        ) : null}

                        {/* Messages */}
                        {(() => {
                            type Block =
                                | { type: "event"; id: string; event: SessionEvent }
                                | { type: "sub-chat"; id: string; events: SessionEvent[] };

                            const blocks: Block[] = [];
                            let inSubChat = false;
                            let currentSubChatEvents: SessionEvent[] = [];

                            for (const event of session.activeEvents) {
                                const isMainChatResponse =
                                    event.type === "user_message" ||
                                    (event.type === "agent_response" && !event.destinationAgent) ||
                                    (event.type === "agent_response_chunk" && !event.destinationAgent) ||
                                    event.type === "reset" ||
                                    event.type === "error";

                                const isExplicitAgentToAgent =
                                    event.type === "agent_to_agent" ||
                                    (event.type === "agent_response" && !!event.destinationAgent) ||
                                    (event.type === "agent_response_chunk" && !!event.destinationAgent) ||
                                    (event.type === "tool_request" && !!event.destinationAgent);

                                if (isMainChatResponse) {
                                    inSubChat = false;
                                    blocks.push({ type: "event", id: event.id, event });
                                } else if (isExplicitAgentToAgent) {
                                    if (!inSubChat) {
                                        inSubChat = true;
                                        currentSubChatEvents = [];
                                        blocks.push({ type: "sub-chat", id: `subchat-${event.id}`, events: currentSubChatEvents });
                                    }
                                    currentSubChatEvents.push(event);
                                } else {
                                    if (inSubChat) {
                                        currentSubChatEvents.push(event);
                                    } else {
                                        blocks.push({ type: "event", id: event.id, event });
                                    }
                                }
                            }

                            return blocks.map((block) => {
                                if (block.type === "event") {
                                    return <MessageEvent key={block.id} event={block.event} />;
                                } else {
                                    return (
                                        <div key={block.id} className="mx-auto max-w-[95%] sm:max-w-[90%] my-2">
                                            <CollapsibleSection
                                                title="Agent Communication"
                                                icon={<Zap className="h-4 w-4 text-emerald-400" />}
                                                defaultOpen
                                            >
                                                <div className="space-y-4 pt-1">
                                                    {block.events.map((e) => (
                                                        <MessageEvent key={e.id} event={e} />
                                                    ))}
                                                </div>
                                            </CollapsibleSection>
                                        </div>
                                    );
                                }
                            });
                        })()}

                        {/* Thinking animation */}
                        {session.isAgentThinking ? <ThinkingDots /> : null}
                    </div>
                </div>

                <Composer
                    activeSessionId={session.activeSessionId}
                    isSubmitting={session.isSubmitting}
                    hasPendingToolRequest={session.hasPendingToolRequest}
                    errorMessage={session.errorMessage}
                    onSendMessage={(text, files) => {
                        session.sendMessage(text, files).catch((error) => {
                            session.setErrorMessage(error instanceof Error ? error.message : "Failed to send message.");
                        });
                    }}
                    onSubmitApproval={(action, feedback) => {
                        session.submitApproval(action, feedback).catch((error) => {
                            session.setErrorMessage(error instanceof Error ? error.message : "Approval failed.");
                        });
                    }}
                    onClearError={() => session.setErrorMessage(null)}
                />
            </div>
        </main>
    );
}
