"use client";

import { SessionSummary } from "@/lib/contracts";
import { Badge } from "@/components/ui/badge";
import { MessageSquarePlus, Trash2 } from "lucide-react";

export interface SidebarProps {
    sessions: SessionSummary[];
    activeSessionId: string | null;
    sidebarOpen: boolean;
    onSelectSession: (sessionId: string) => void;
    onCreateSession: () => void;
    onDeleteSession: (sessionId: string) => void;
}

export function Sidebar({
    sessions,
    activeSessionId,
    sidebarOpen,
    onSelectSession,
    onCreateSession,
    onDeleteSession
}: SidebarProps) {
    return (
        <aside
            className={`absolute inset-y-0 left-0 z-30 md:static ${sidebarOpen ? "w-[85vw] max-w-[260px] md:w-[260px]" : "w-0"
                } shrink-0 flex flex-col bg-sidebar border-r border-border/40 transition-all duration-300 overflow-hidden`}
        >
            {/* Sidebar header */}
            <div className="flex items-center justify-between p-3 border-b border-border/30">
                <span className="text-sm font-semibold text-foreground truncate">Conversations</span>
                <button
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    onClick={onCreateSession}
                    title="New conversation"
                >
                    <MessageSquarePlus className="h-4 w-4" />
                </button>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {sessions.map((session) => (
                    <div key={session.sessionId} className="group relative">
                        <button
                            className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors ${activeSessionId === session.sessionId
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                                }`}
                            onClick={() => onSelectSession(session.sessionId)}
                        >
                            <p className="truncate font-medium">{session.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[11px] opacity-60">{session.activeAgentName}</span>
                                {session.hasPendingToolRequest ? (
                                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                        Pending
                                    </Badge>
                                ) : null}
                                {session.continuousMode ? (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                        Auto
                                    </Badge>
                                ) : null}
                            </div>
                        </button>
                        <button
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                            onClick={() => onDeleteSession(session.sessionId)}
                            title="Delete conversation"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ))}

                {sessions.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-8">No conversations yet</p>
                ) : null}
            </div>
        </aside>
    );
}
