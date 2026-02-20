"use client";

import {
    ApprovalRequest,
    CreateSessionResponse,
    DownloadableFile,
    ListSessionsResponse,
    SessionEvent,
    SessionState,
    SessionSummary,
    SetActiveAgentResponse,
    ToggleContinuousModeResponse
} from "@/lib/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    ArrowUp,
    Bot,
    ChevronDown,
    ChevronRight,
    FilePlus2,
    Loader2,
    Menu,
    MessageSquarePlus,
    Paperclip,
    RefreshCw,
    Trash2,
    User,
    Wrench,
    X,
    Zap
} from "lucide-react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { DragEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ── Types ──────────────────────────────────────────────── */

type EventMap = Record<string, SessionEvent[]>;
type StateMap = Record<string, SessionState>;
type ErrorPayload = { error?: { code?: string; message?: string } };

const CHAT_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

const CHAT_MARKDOWN_CLASS =
    "prose prose-sm prose-invert max-w-none break-words text-foreground " +
    "prose-headings:my-2 prose-p:my-1 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 " +
    "prose-pre:my-2 prose-pre:max-h-96 prose-pre:overflow-auto prose-pre:rounded-lg prose-pre:bg-[hsl(0,0%,10%)] prose-pre:p-0 " +
    "prose-code:before:content-none prose-code:after:content-none";

/* Custom component renderers for ReactMarkdown */
const markdownComponents: Components = {
    table: ({ children, ...props }) => (
        <div className="my-2 overflow-x-auto rounded-lg border border-border/50">
            <table className="min-w-full text-sm" {...props}>{children}</table>
        </div>
    ),
    thead: ({ children, ...props }) => (
        <thead className="bg-secondary/60 text-left text-xs font-medium text-muted-foreground" {...props}>{children}</thead>
    ),
    th: ({ children, ...props }) => (
        <th className="px-3 py-2 font-semibold" {...props}>{children}</th>
    ),
    td: ({ children, ...props }) => (
        <td className="border-t border-border/30 px-3 py-2" {...props}>{children}</td>
    ),
    tr: ({ children, ...props }) => (
        <tr className="transition-colors hover:bg-secondary/30" {...props}>{children}</tr>
    ),
    code: ({ className, children, ...props }) => {
        const isBlock = /language-(\w+)/.test(className || "");
        if (isBlock) {
            return (
                <code className={`block rounded-lg bg-[hsl(0,0%,10%)] p-4 text-xs font-mono overflow-auto ${className || ""}`} {...props}>
                    {children}
                </code>
            );
        }
        return (
            <code className="rounded-md bg-[hsl(0,0%,18%)] px-1.5 py-0.5 text-[0.85em] font-mono" {...props}>
                {children}
            </code>
        );
    },
    a: ({ children, ...props }) => (
        <a className="text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
    ),
    blockquote: ({ children, ...props }) => (
        <blockquote className="border-l-2 border-muted-foreground/40 pl-4 italic text-muted-foreground" {...props}>{children}</blockquote>
    ),
    hr: (props) => (
        <hr className="my-4 border-border/40" {...props} />
    ),
};

/* ── Utilities ──────────────────────────────────────────── */

function formatTime(iso: string) {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function apiErrorMessage(errorPayload: unknown, fallback: string): string {
    if (typeof errorPayload === "object" && errorPayload !== null) {
        const maybeError = (errorPayload as { error?: { message?: unknown } }).error;
        if (maybeError && typeof maybeError.message === "string") {
            return maybeError.message;
        }
    }
    return fallback;
}

function apiErrorCode(errorPayload: unknown): string | undefined {
    if (typeof errorPayload === "object" && errorPayload !== null) {
        const maybeError = (errorPayload as ErrorPayload).error;
        if (maybeError && typeof maybeError.code === "string") {
            return maybeError.code;
        }
    }
    return undefined;
}

function isChatImageFile(file: File) {
    return CHAT_IMAGE_MIME_TYPES.has(file.type.toLowerCase());
}

function fileFingerprint(file: File) {
    return `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
}

/* ── Sub-components ─────────────────────────────────────── */

function ThinkingDots() {
    return (
        <div className="flex items-start gap-3 animate-msg-in">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                <Bot className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-1 rounded-2xl rounded-tl-sm bg-secondary px-4 py-3">
                <div className="thinking-dots flex items-center gap-0.5">
                    <span />
                    <span />
                    <span />
                </div>
            </div>
        </div>
    );
}

function ScrollableCodeBlock({ text }: { text: string }) {
    return (
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-[hsl(0,0%,10%)] p-3 text-xs text-foreground/90 font-mono">
            {text}
        </pre>
    );
}

function CollapsibleSection({ title, icon, children, defaultOpen = false }: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
    defaultOpen?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="rounded-xl border border-border/50 bg-secondary/30 overflow-hidden animate-msg-in">
            <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary/50 transition-colors"
                onClick={() => setIsOpen((o) => !o)}
            >
                {icon}
                <span className="flex-1">{title}</span>
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {isOpen ? <div className="border-t border-border/30 px-3 py-2">{children}</div> : null}
        </div>
    );
}

function DownloadLinks({ files }: { files: DownloadableFile[] }) {
    if (files.length === 0) return null;
    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map((file) => (
                <a
                    key={file.fileId}
                    href={file.href}
                    className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                    📎 {file.fileName}
                </a>
            ))}
        </div>
    );
}

/* ── Main Component ─────────────────────────────────────── */

export function ChatApp() {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [sessionStates, setSessionStates] = useState<StateMap>({});
    const [eventsBySession, setEventsBySession] = useState<EventMap>({});
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [message, setMessage] = useState("");
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    const [isComposerDragOver, setIsComposerDragOver] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [disapproveMessage, setDisapproveMessage] = useState("");
    const [showDisapproveBox, setShowDisapproveBox] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const dragDepthRef = useRef(0);
    const conversationScrollRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const activeState = activeSessionId ? sessionStates[activeSessionId] : undefined;
    const activeEvents = activeSessionId ? eventsBySession[activeSessionId] ?? [] : [];

    /* ── Session helpers (logic unchanged) ─────────────── */

    const upsertSessionSummary = useCallback((summary: SessionSummary) => {
        setSessions((current) => {
            const next = [...current.filter((entry) => entry.sessionId !== summary.sessionId), summary];
            next.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
            return next;
        });
    }, []);

    const upsertSessionState = useCallback(
        (state: SessionState) => {
            setSessionStates((current) => ({ ...current, [state.sessionId]: state }));
            upsertSessionSummary(state);
        },
        [upsertSessionSummary]
    );

    const appendEvent = useCallback(
        (event: SessionEvent) => {
            setEventsBySession((current) => {
                const existing = current[event.sessionId] ?? [];

                if (event.type === "agent_response_chunk") {
                    if (existing.some((entry) => entry.type === "agent_response" && entry.messageId === event.messageId)) {
                        return current;
                    }

                    const existingChunkIndex = existing.findIndex(
                        (entry) => entry.type === "agent_response_chunk" && entry.messageId === event.messageId
                    );

                    if (existingChunkIndex >= 0) {
                        const existingChunk = existing[existingChunkIndex] as Extract<SessionEvent, { type: "agent_response_chunk" }>;
                        const mergedChunk: Extract<SessionEvent, { type: "agent_response_chunk" }> = {
                            ...existingChunk,
                            id: event.id,
                            timestamp: event.timestamp,
                            markdownChunk: `${existingChunk.markdownChunk}${event.markdownChunk}`
                        };

                        const mergedEvents = [...existing];
                        mergedEvents[existingChunkIndex] = mergedChunk;
                        return { ...current, [event.sessionId]: mergedEvents };
                    }

                    return { ...current, [event.sessionId]: [...existing, event] };
                }

                if (event.type === "agent_response") {
                    const withoutRelatedChunks = existing.filter(
                        (entry) => !(entry.type === "agent_response_chunk" && entry.messageId === event.messageId)
                    );
                    if (withoutRelatedChunks.some((entry) => entry.id === event.id)) {
                        return current;
                    }
                    return { ...current, [event.sessionId]: [...withoutRelatedChunks, event] };
                }

                if (event.type === "agent_to_agent") {
                    const withoutRelatedChunks = event.messageId
                        ? existing.filter((entry) => !(entry.type === "agent_response_chunk" && entry.messageId === event.messageId))
                        : existing;

                    if (withoutRelatedChunks.some((entry) => entry.id === event.id)) {
                        return current;
                    }
                    return { ...current, [event.sessionId]: [...withoutRelatedChunks, event] };
                }

                if (existing.some((entry) => entry.id === event.id)) {
                    return current;
                }

                return { ...current, [event.sessionId]: [...existing, event] };
            });

            if (event.type === "state_changed") {
                upsertSessionState(event.state);
            }
        },
        [upsertSessionState]
    );

    const createSession = useCallback(
        async (name?: string) => {
            const response = await fetch("/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name?.trim() || undefined })
            });

            const payload = (await response.json()) as CreateSessionResponse | { error?: { message?: string } };
            if (!response.ok) {
                throw new Error(apiErrorMessage(payload, "Unable to create a new session."));
            }

            const success = payload as CreateSessionResponse;
            upsertSessionState(success.session);
            setActiveSessionId(success.session.sessionId);
            return success.session;
        },
        [upsertSessionState]
    );

    const refreshSessions = useCallback(async () => {
        const response = await fetch("/api/sessions", {
            method: "GET",
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" }
        });

        const payload = (await response.json()) as ListSessionsResponse | { error?: { message?: string } };
        if (!response.ok) {
            throw new Error(apiErrorMessage(payload, "Unable to load sessions."));
        }

        const success = payload as ListSessionsResponse;
        setSessions(success.sessions);
        const validIds = new Set(success.sessions.map((entry) => entry.sessionId));
        setSessionStates((current) => {
            const next: StateMap = {};
            for (const [sessionId, state] of Object.entries(current)) {
                if (validIds.has(sessionId)) {
                    next[sessionId] = state;
                }
            }
            return next;
        });
        setEventsBySession((current) => {
            const next: EventMap = {};
            for (const [sessionId, events] of Object.entries(current)) {
                if (validIds.has(sessionId)) {
                    next[sessionId] = events;
                }
            }
            return next;
        });
        return success.sessions;
    }, []);

    const recoverFromMissingSession = useCallback(
        async (missingSessionId: string) => {
            const latestSessions = await refreshSessions();
            if (latestSessions.some((session) => session.sessionId === missingSessionId)) {
                return missingSessionId;
            }

            if (latestSessions.length === 0) {
                setActiveSessionId(null);
                setErrorMessage(`Session "${missingSessionId}" was not found. Create a new conversation.`);
                return null;
            }

            const fallback = latestSessions[0]!;
            setActiveSessionId(fallback.sessionId);
            setErrorMessage(`Session "${missingSessionId}" was not found. Switched to "${fallback.name}".`);
            return fallback.sessionId;
        },
        [refreshSessions]
    );

    const recoverFromSessionNotFoundResponse = useCallback(
        async (sessionId: string, response: Response, payload: unknown) => {
            if (response.status === 404 && apiErrorCode(payload) === "SESSION_NOT_FOUND") {
                await recoverFromMissingSession(sessionId);
                return true;
            }
            return false;
        },
        [recoverFromMissingSession]
    );

    /* ── Effects ──────────────────────────────────────── */

    useEffect(() => {
        (async () => {
            setIsLoading(true);
            try {
                const latestSessions = await refreshSessions();
                if (latestSessions.length === 0) {
                    setActiveSessionId(null);
                } else {
                    setActiveSessionId((current) =>
                        current && latestSessions.some((session) => session.sessionId === current)
                            ? current
                            : latestSessions[0]!.sessionId
                    );
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Failed to initialize the chat.");
            } finally {
                setIsLoading(false);
            }
        })();
    }, [refreshSessions]);

    useEffect(() => {
        if (!activeSessionId) return;

        const eventSource = new EventSource(`/api/sessions/${activeSessionId}/stream`);

        eventSource.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data) as SessionEvent;
                appendEvent(parsed);
            } catch {
                return;
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
            recoverFromMissingSession(activeSessionId).catch((error) => {
                setErrorMessage(error instanceof Error ? error.message : "Failed to recover session state.");
            });
        };

        return () => {
            eventSource.close();
        };
    }, [activeSessionId, appendEvent, recoverFromMissingSession]);

    /* ── Actions ──────────────────────────────────────── */

    const sendMessage = useCallback(async () => {
        if (!activeSessionId || isSubmitting) return;

        if (message.trim().length === 0 && attachedFiles.length === 0) {
            setErrorMessage("Write a message or attach files before sending.");
            return;
        }

        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append("message", message);
            for (const file of attachedFiles) {
                formData.append("workspaceFiles", file);
            }
            for (const image of attachedFiles.filter((file) => isChatImageFile(file))) {
                formData.append("chatImages", image);
            }

            const response = await fetch(`/api/sessions/${activeSessionId}/message`, {
                method: "POST",
                body: formData
            });

            const payload = await response.json();
            if (!response.ok) {
                if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) return;
                throw new Error(apiErrorMessage(payload, "Message failed."));
            }

            setMessage("");
            setAttachedFiles([]);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Message failed.");
        } finally {
            setIsSubmitting(false);
        }
    }, [activeSessionId, attachedFiles, isSubmitting, message, recoverFromSessionNotFoundResponse]);

    const submitApproval = useCallback(
        async (action: ApprovalRequest["action"]) => {
            if (!activeSessionId) return;

            if (action === "disapprove" && disapproveMessage.trim().length === 0) {
                setErrorMessage("Disapproval requires a feedback message.");
                return;
            }

            setErrorMessage(null);
            setIsSubmitting(true);
            try {
                const response = await fetch(`/api/sessions/${activeSessionId}/approval`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action,
                        feedback: action === "disapprove" ? disapproveMessage : undefined
                    } satisfies ApprovalRequest)
                });

                const payload = await response.json();
                if (!response.ok) {
                    if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) return;
                    throw new Error(apiErrorMessage(payload, "Failed to submit approval."));
                }

                setDisapproveMessage("");
                setShowDisapproveBox(false);
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Approval request failed.");
            } finally {
                setIsSubmitting(false);
            }
        },
        [activeSessionId, disapproveMessage, recoverFromSessionNotFoundResponse]
    );

    const setContinuousMode = useCallback(
        async (enabled: boolean) => {
            if (!activeSessionId) return;

            setErrorMessage(null);
            try {
                const response = await fetch(`/api/sessions/${activeSessionId}/continuous-mode`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled })
                });

                const payload = (await response.json()) as ToggleContinuousModeResponse | { error?: { message?: string } };
                if (!response.ok) {
                    if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) return;
                    throw new Error(apiErrorMessage(payload, "Failed to set continuous mode."));
                }

                const success = payload as ToggleContinuousModeResponse;
                upsertSessionState(success.session);
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Failed to set continuous mode.");
            }
        },
        [activeSessionId, recoverFromSessionNotFoundResponse, upsertSessionState]
    );

    const setActiveAgent = useCallback(
        async (agentName: string) => {
            if (!activeSessionId) return;

            setErrorMessage(null);
            try {
                const response = await fetch(`/api/sessions/${activeSessionId}/active-agent`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ agentName })
                });

                const payload = (await response.json()) as SetActiveAgentResponse | { error?: { message?: string } };
                if (!response.ok) {
                    if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) return;
                    throw new Error(apiErrorMessage(payload, "Failed to switch active agent."));
                }

                const success = payload as SetActiveAgentResponse;
                upsertSessionState(success.session);
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Failed to switch active agent.");
            }
        },
        [activeSessionId, recoverFromSessionNotFoundResponse, upsertSessionState]
    );

    const resetSession = useCallback(async () => {
        if (!activeSessionId) return;

        setErrorMessage(null);
        try {
            const response = await fetch(`/api/sessions/${activeSessionId}/reset`, { method: "POST" });
            const payload = await response.json();
            if (!response.ok) {
                if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) return;
                throw new Error(apiErrorMessage(payload, "Failed to reset session."));
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to reset session.");
        }
    }, [activeSessionId, recoverFromSessionNotFoundResponse]);

    const deleteSession = useCallback(
        async (sessionId: string) => {
            setErrorMessage(null);
            try {
                const response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(apiErrorMessage(payload, "Failed to delete session."));
                }

                const remaining = sessions.filter((entry) => entry.sessionId !== sessionId);
                setSessions(remaining);
                setSessionStates((current) => {
                    const { [sessionId]: _removed, ...rest } = current;
                    return rest;
                });
                setEventsBySession((current) => {
                    const { [sessionId]: _removed, ...rest } = current;
                    return rest;
                });

                if (activeSessionId === sessionId) {
                    if (remaining.length > 0) {
                        setActiveSessionId(remaining[0]!.sessionId);
                    } else {
                        setActiveSessionId(null);
                    }
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Failed to delete session.");
            }
        },
        [activeSessionId, sessions]
    );

    /* ── Drag & drop / Files ─────────────────────────── */

    const pendingToolRequest = activeState?.pendingToolRequest;
    const disableComposer = isSubmitting || Boolean(pendingToolRequest);

    const addDroppedFiles = useCallback((incomingFiles: File[]) => {
        if (incomingFiles.length === 0) return;
        setAttachedFiles((current) => {
            const existingFingerprints = new Set(current.map((file) => fileFingerprint(file)));
            const uniqueIncoming = incomingFiles.filter((file) => !existingFingerprints.has(fileFingerprint(file)));
            return [...current, ...uniqueIncoming];
        });
    }, []);

    const removeAttachedFile = useCallback((fingerprint: string) => {
        setAttachedFiles((current) => {
            let removed = false;
            return current.filter((file) => {
                if (!removed && fileFingerprint(file) === fingerprint) {
                    removed = true;
                    return false;
                }
                return true;
            });
        });
    }, []);

    const handleComposerDragEnter = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            if (disableComposer || !activeSessionId) return;
            if (!event.dataTransfer.types.includes("Files")) return;
            dragDepthRef.current += 1;
            setIsComposerDragOver(true);
        },
        [activeSessionId, disableComposer]
    );

    const handleComposerDragOver = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            if (disableComposer || !activeSessionId) return;
            event.dataTransfer.dropEffect = "copy";
        },
        [activeSessionId, disableComposer]
    );

    const handleComposerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
            setIsComposerDragOver(false);
        }
    }, []);

    const handleComposerDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            dragDepthRef.current = 0;
            setIsComposerDragOver(false);
            if (disableComposer || !activeSessionId) return;
            addDroppedFiles(Array.from(event.dataTransfer.files ?? []));
        },
        [activeSessionId, addDroppedFiles, disableComposer]
    );

    /* ── Auto-resize textarea ────────────────────────── */

    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }, [message]);

    /* ── Computed ─────────────────────────────────────── */

    const sessionLabel = useMemo(() => {
        if (!activeState) return "Agent Mimir";
        return activeState.name;
    }, [activeState]);

    useEffect(() => {
        const container = conversationScrollRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    }, [activeEvents, activeSessionId]);

    /* Check if the agent is currently "thinking" — we just sent a message and no response came back yet */
    const isAgentThinking = useMemo(() => {
        if (!isSubmitting && activeEvents.length > 0) {
            const lastEvent = activeEvents[activeEvents.length - 1];
            if (lastEvent && lastEvent.type === "user_message") return true;
        }
        return isSubmitting;
    }, [isSubmitting, activeEvents]);

    /* ── Loading screen ──────────────────────────────── */

    if (isLoading) {
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

    /* ── Render ───────────────────────────────────────── */

    return (
        <main className="app-shell flex h-[100dvh] overflow-hidden bg-background">
            {/* ── Sidebar ───────────────────────────────── */}
            <aside
                className={`${sidebarOpen ? "w-[260px]" : "w-0"
                    } shrink-0 flex flex-col bg-sidebar border-r border-border/40 transition-all duration-300 overflow-hidden`}
            >
                {/* Sidebar header */}
                <div className="flex items-center justify-between p-3 border-b border-border/30">
                    <span className="text-sm font-semibold text-foreground truncate">Conversations</span>
                    <button
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        onClick={() => {
                            createSession().catch((error) => {
                                setErrorMessage(error instanceof Error ? error.message : "Failed to create session.");
                            });
                        }}
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
                                onClick={() => setActiveSessionId(session.sessionId)}
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
                                onClick={() => {
                                    deleteSession(session.sessionId).catch((error) => {
                                        setErrorMessage(error instanceof Error ? error.message : "Failed to delete session.");
                                    });
                                }}
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

            {/* ── Main area ─────────────────────────────── */}
            <div className="flex flex-1 flex-col min-w-0">
                {/* Top bar */}
                <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 bg-background/80 backdrop-blur-sm shrink-0">
                    <button
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        onClick={() => setSidebarOpen((o) => !o)}
                        title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                    >
                        <Menu className="h-5 w-5" />
                    </button>

                    <div className="flex-1 min-w-0">
                        <h1 className="text-sm font-semibold truncate">{sessionLabel}</h1>
                        {activeState ? (
                            <p className="text-xs text-muted-foreground truncate">
                                Agent: {activeState.activeAgentName}
                            </p>
                        ) : null}
                    </div>

                    {activeState ? (
                        <div className="flex items-center gap-2 shrink-0">
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                                <Zap className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Auto</span>
                                <Switch
                                    checked={activeState.continuousMode}
                                    onCheckedChange={(checked) => {
                                        setContinuousMode(Boolean(checked)).catch((error) => {
                                            setErrorMessage(error instanceof Error ? error.message : "Could not toggle continuous mode.");
                                        });
                                    }}
                                />
                            </label>

                            <select
                                className="h-8 rounded-lg border border-border bg-secondary px-2 text-xs text-foreground appearance-none cursor-pointer"
                                value={activeState.activeAgentName}
                                onChange={(event) => {
                                    setActiveAgent(event.target.value).catch((error) => {
                                        setErrorMessage(error instanceof Error ? error.message : "Could not change agent.");
                                    });
                                }}
                            >
                                {activeState.agentNames.map((agentName) => (
                                    <option key={agentName} value={agentName}>
                                        {agentName}
                                    </option>
                                ))}
                            </select>

                            <button
                                className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                onClick={() => {
                                    resetSession().catch((error) => {
                                        setErrorMessage(error instanceof Error ? error.message : "Could not reset session.");
                                    });
                                }}
                                title="Reset session"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </button>
                        </div>
                    ) : null}
                </header>

                {/* ── Chat messages ──────────────────────── */}
                <div ref={conversationScrollRef} className="flex-1 overflow-y-auto overscroll-contain">
                    <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
                        {/* Empty state */}
                        {activeEvents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24 text-center">
                                <Bot className="h-12 w-12 text-muted-foreground/40 mb-4" />
                                <h2 className="text-lg font-heading font-semibold text-foreground/80 mb-1">
                                    {activeSessionId ? "Start a conversation" : "Create a conversation"}
                                </h2>
                                <p className="text-sm text-muted-foreground max-w-sm">
                                    {activeSessionId
                                        ? "Send a message to begin chatting with your agent."
                                        : "Click the + button in the sidebar to create your first conversation."}
                                </p>
                            </div>
                        ) : null}

                        {/* Messages */}
                        {activeEvents.map((event) => {
                            if (event.type === "state_changed") return null;

                            /* ── User message ─────────────── */
                            if (event.type === "user_message") {
                                return (
                                    <div key={event.id} className="flex justify-end animate-msg-in">
                                        <div className="max-w-[80%] flex items-start gap-2.5">
                                            <div className="rounded-2xl rounded-tr-sm bg-user-bubble px-4 py-2.5">
                                                <p className="whitespace-pre-wrap text-sm text-foreground">{event.text || "(No text)"}</p>
                                                {event.workspaceFiles.length > 0 ? (
                                                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                                                        📂 {event.workspaceFiles.join(", ")}
                                                    </p>
                                                ) : null}
                                                {event.chatImages.length > 0 ? (
                                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                                        🖼️ {event.chatImages.join(", ")}
                                                    </p>
                                                ) : null}
                                            </div>
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent">
                                                <User className="h-4 w-4 text-muted-foreground" />
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            /* ── Agent response ───────────── */
                            if (event.type === "agent_response") {
                                return (
                                    <div key={event.id} className="flex items-start gap-3 animate-msg-in">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                                            <Bot className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-medium text-muted-foreground">{event.agentName}</span>
                                                <span className="text-[10px] text-muted-foreground/60">{formatTime(event.timestamp)}</span>
                                            </div>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} className={CHAT_MARKDOWN_CLASS} components={markdownComponents}>
                                                {event.markdown}
                                            </ReactMarkdown>
                                            <DownloadLinks files={event.attachments} />
                                        </div>
                                    </div>
                                );
                            }

                            /* ── Agent response chunk (streaming) ── */
                            if (event.type === "agent_response_chunk") {
                                return (
                                    <div key={event.id} className="flex items-start gap-3">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                                            <Bot className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-medium text-muted-foreground">{event.agentName}</span>
                                                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse-glow" title="Streaming..." />
                                            </div>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} className={CHAT_MARKDOWN_CLASS} components={markdownComponents}>
                                                {event.markdownChunk}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                );
                            }

                            /* ── Tool response ────────────── */
                            if (event.type === "tool_response") {
                                return (
                                    <div key={event.id} className="mx-auto max-w-[85%]">
                                        <CollapsibleSection
                                            title={`Tool Response: ${event.toolName} [${event.agentName}]`}
                                            icon={<Wrench className="h-3.5 w-3.5 text-cyan-400" />}
                                        >
                                            <ScrollableCodeBlock text={event.response} />
                                        </CollapsibleSection>
                                    </div>
                                );
                            }

                            /* ── Tool request ─────────────── */
                            if (event.type === "tool_request") {
                                const title = event.requiresApproval
                                    ? `Tool Approval: ${event.payload.callingAgent}`
                                    : `Tool Call (auto): ${event.payload.callingAgent}`;
                                return (
                                    <div key={event.id} className="mx-auto max-w-[85%]">
                                        <CollapsibleSection
                                            title={title}
                                            icon={<Wrench className="h-3.5 w-3.5 text-amber-400" />}
                                            defaultOpen={event.requiresApproval}
                                        >
                                            <div className="space-y-2">
                                                <ScrollableCodeBlock text={event.payload.content} />
                                                {event.payload.toolCalls.map((call, index) => (
                                                    <div key={`${event.id}-${index}`} className="border-t border-border/30 pt-2">
                                                        <p className="text-xs font-semibold text-foreground mb-1">{call.toolName}</p>
                                                        <ScrollableCodeBlock text={call.input} />
                                                    </div>
                                                ))}
                                            </div>
                                        </CollapsibleSection>
                                    </div>
                                );
                            }

                            /* ── Agent-to-Agent ───────────── */
                            if (event.type === "agent_to_agent") {
                                return (
                                    <div key={event.id} className="mx-auto max-w-[85%]">
                                        <CollapsibleSection
                                            title={`${event.sourceAgent} → ${event.destinationAgent}`}
                                            icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
                                            defaultOpen
                                        >
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} className={CHAT_MARKDOWN_CLASS} components={markdownComponents}>
                                                {event.message}
                                            </ReactMarkdown>
                                            <DownloadLinks files={event.attachments} />
                                        </CollapsibleSection>
                                    </div>
                                );
                            }

                            /* ── Reset ─────────────────────── */
                            if (event.type === "reset") {
                                return (
                                    <div key={event.id} className="flex justify-center animate-msg-in">
                                        <div className="rounded-full bg-secondary/50 px-4 py-1.5 text-xs text-muted-foreground">
                                            🔄 {event.message}
                                        </div>
                                    </div>
                                );
                            }

                            /* ── Error ─────────────────────── */
                            return (
                                <div key={event.id} className="mx-auto max-w-[85%] animate-msg-in">
                                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                                        <p className="text-xs font-semibold text-red-400 mb-1">{event.code ?? "Error"}</p>
                                        <p className="text-sm text-foreground/90">{event.message}</p>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Thinking animation */}
                        {isAgentThinking ? <ThinkingDots /> : null}
                    </div>
                </div>

                {/* ── Bottom composer area ───────────────── */}
                <div className="shrink-0 border-t border-border/20 bg-background">
                    <div className="mx-auto max-w-3xl px-4 py-3 space-y-2">
                        {/* Approval bar */}
                        {pendingToolRequest ? (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 animate-msg-in">
                                <div className="flex items-center gap-2 mb-2">
                                    <Wrench className="h-4 w-4 text-amber-400" />
                                    <span className="text-sm font-medium text-foreground">Tool request awaiting your decision</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        size="sm"
                                        onClick={() => {
                                            submitApproval("approve").catch((error) => {
                                                setErrorMessage(error instanceof Error ? error.message : "Approval failed.");
                                            });
                                        }}
                                        disabled={isSubmitting}
                                        className="rounded-lg"
                                    >
                                        {isSubmitting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                                        Approve
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => setShowDisapproveBox((current) => !current)}
                                        disabled={isSubmitting}
                                        className="rounded-lg"
                                    >
                                        Disapprove
                                    </Button>
                                </div>
                                {showDisapproveBox ? (
                                    <div className="mt-3 space-y-2">
                                        <Textarea
                                            value={disapproveMessage}
                                            onChange={(event) => setDisapproveMessage(event.target.value)}
                                            placeholder="Explain why this should not run..."
                                            className="min-h-[60px] rounded-lg bg-background/50 text-sm"
                                        />
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => {
                                                submitApproval("disapprove").catch((error) => {
                                                    setErrorMessage(error instanceof Error ? error.message : "Disapproval failed.");
                                                });
                                            }}
                                            disabled={isSubmitting}
                                            className="rounded-lg"
                                        >
                                            Send Disapproval
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {/* Error message */}
                        {errorMessage ? (
                            <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                                <span className="flex-1">{errorMessage}</span>
                                <button
                                    onClick={() => setErrorMessage(null)}
                                    className="shrink-0 rounded-md p-0.5 hover:bg-red-500/20 transition-colors"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ) : null}

                        {/* Composer */}
                        <div
                            onDragEnter={handleComposerDragEnter}
                            onDragOver={handleComposerDragOver}
                            onDragLeave={handleComposerDragLeave}
                            onDrop={handleComposerDrop}
                            className={`relative rounded-2xl border transition-all ${isComposerDragOver
                                ? "border-emerald-500/50 bg-emerald-500/5 shadow-lg shadow-emerald-500/10"
                                : "border-border/60 bg-secondary/40 hover:border-border"
                                }`}
                        >
                            {/* Attached files */}
                            {attachedFiles.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                                    {attachedFiles.map((file, index) => {
                                        const fingerprint = fileFingerprint(file);
                                        return (
                                            <div
                                                key={`${fingerprint}-${index}`}
                                                className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"
                                            >
                                                <Paperclip className="h-3 w-3" />
                                                <span className="max-w-[180px] truncate">{file.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removeAttachedFile(fingerprint)}
                                                    className="rounded p-0.5 hover:bg-accent hover:text-foreground transition-colors"
                                                    aria-label={`Remove ${file.name}`}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}

                            <div className="flex items-end gap-2 p-2">
                                {/* File attach button */}
                                <button
                                    type="button"
                                    className="shrink-0 rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={disableComposer || !activeSessionId}
                                    title="Attach files"
                                >
                                    <Paperclip className="h-4 w-4" />
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                        addDroppedFiles(Array.from(e.target.files ?? []));
                                        if (fileInputRef.current) fileInputRef.current.value = "";
                                    }}
                                />

                                {/* Textarea */}
                                <textarea
                                    ref={textareaRef}
                                    value={message}
                                    onChange={(event) => setMessage(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                                        event.preventDefault();
                                        if (disableComposer || !activeSessionId) return;
                                        sendMessage().catch((error) => {
                                            setErrorMessage(error instanceof Error ? error.message : "Failed to send message.");
                                        });
                                    }}
                                    placeholder={activeSessionId ? "Message Agent Mimir..." : "Create a conversation first..."}
                                    disabled={disableComposer || !activeSessionId}
                                    className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50 py-2 max-h-[200px]"
                                    rows={1}
                                />

                                {/* Send button */}
                                <button
                                    type="button"
                                    onClick={() => {
                                        sendMessage().catch((error) => {
                                            setErrorMessage(error instanceof Error ? error.message : "Failed to send message.");
                                        });
                                    }}
                                    disabled={!activeSessionId || disableComposer || (message.trim().length === 0 && attachedFiles.length === 0)}
                                    className="shrink-0 rounded-full bg-foreground p-2 text-background transition-all hover:bg-foreground/90 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Send message"
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <ArrowUp className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        <p className="text-center text-[11px] text-muted-foreground/50">
                            Agent Mimir may produce inaccurate information. Drag files into the input to attach.
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
