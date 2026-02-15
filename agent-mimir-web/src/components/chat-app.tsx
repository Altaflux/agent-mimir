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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FilePlus2, RefreshCw, SendHorizontal, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type EventMap = Record<string, SessionEvent[]>;
type StateMap = Record<string, SessionState>;
type ErrorPayload = { error?: { code?: string; message?: string } };
const CHAT_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

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

function downloadLinks(files: DownloadableFile[]) {
    if (files.length === 0) {
        return null;
    }

    return (
        <div className="mt-2 flex flex-wrap gap-2">
            {files.map((file) => (
                <a
                    key={file.fileId}
                    href={file.href}
                    className="rounded-full border border-border bg-background px-3 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
                >
                    {file.fileName}
                </a>
            ))}
        </div>
    );
}

function ScrollableCodeBlock({ text }: { text: string }) {
    return <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-background/70 p-3 text-xs text-foreground/90">{text}</pre>;
}

function isChatImageFile(file: File) {
    return CHAT_IMAGE_MIME_TYPES.has(file.type.toLowerCase());
}

function fileFingerprint(file: File) {
    return `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
}

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

    const dragDepthRef = useRef(0);

    const activeState = activeSessionId ? sessionStates[activeSessionId] : undefined;
    const activeEvents = activeSessionId ? eventsBySession[activeSessionId] ?? [] : [];

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
                if (existing.some((entry) => entry.id === event.id)) {
                    return current;
                }

                return {
                    ...current,
                    [event.sessionId]: [...existing, event]
                };
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
                headers: {
                    "Content-Type": "application/json"
                },
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
            headers: {
                "Cache-Control": "no-cache"
            }
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
        if (!activeSessionId) {
            return;
        }

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

    const sendMessage = useCallback(async () => {
        if (!activeSessionId || isSubmitting) {
            return;
        }

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
                if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) {
                    return;
                }
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
            if (!activeSessionId) {
                return;
            }

            if (action === "disapprove" && disapproveMessage.trim().length === 0) {
                setErrorMessage("Disapproval requires a feedback message.");
                return;
            }

            setErrorMessage(null);
            setIsSubmitting(true);
            try {
                const response = await fetch(`/api/sessions/${activeSessionId}/approval`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        action,
                        feedback: action === "disapprove" ? disapproveMessage : undefined
                    } satisfies ApprovalRequest)
                });

                const payload = await response.json();
                if (!response.ok) {
                    if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) {
                        return;
                    }
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
            if (!activeSessionId) {
                return;
            }

            setErrorMessage(null);
            try {
                const response = await fetch(`/api/sessions/${activeSessionId}/continuous-mode`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ enabled })
                });

                const payload = (await response.json()) as ToggleContinuousModeResponse | { error?: { message?: string } };
                if (!response.ok) {
                    if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) {
                        return;
                    }
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
            if (!activeSessionId) {
                return;
            }

            setErrorMessage(null);
            try {
                const response = await fetch(`/api/sessions/${activeSessionId}/active-agent`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ agentName })
                });

                const payload = (await response.json()) as SetActiveAgentResponse | { error?: { message?: string } };
                if (!response.ok) {
                    if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) {
                        return;
                    }
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
        if (!activeSessionId) {
            return;
        }

        setErrorMessage(null);
        try {
            const response = await fetch(`/api/sessions/${activeSessionId}/reset`, { method: "POST" });
            const payload = await response.json();
            if (!response.ok) {
                if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) {
                    return;
                }
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
                const response = await fetch(`/api/sessions/${sessionId}`, {
                    method: "DELETE"
                });

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

    const pendingToolRequest = activeState?.pendingToolRequest;
    const disableComposer = isSubmitting || Boolean(pendingToolRequest);

    const addDroppedFiles = useCallback((incomingFiles: File[]) => {
        if (incomingFiles.length === 0) {
            return;
        }

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
            if (disableComposer || !activeSessionId) {
                return;
            }

            if (!event.dataTransfer.types.includes("Files")) {
                return;
            }

            dragDepthRef.current += 1;
            setIsComposerDragOver(true);
        },
        [activeSessionId, disableComposer]
    );

    const handleComposerDragOver = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            if (disableComposer || !activeSessionId) {
                return;
            }
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

            if (disableComposer || !activeSessionId) {
                return;
            }

            addDroppedFiles(Array.from(event.dataTransfer.files ?? []));
        },
        [activeSessionId, addDroppedFiles, disableComposer]
    );

    const sessionLabel = useMemo(() => {
        if (!activeState) {
            return "No active conversation";
        }

        return `${activeState.name} (${activeState.activeAgentName})`;
    }, [activeState]);

    if (isLoading) {
        return (
            <main className="app-shell mx-auto flex min-h-screen w-full max-w-[1280px] items-center justify-center p-6">
                <Card className="w-full max-w-md border-border/60 bg-card/75 shadow-2xl shadow-black/30 backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle>Loading Agent Mimir Web</CardTitle>
                        <CardDescription>Preparing your session runtime.</CardDescription>
                    </CardHeader>
                </Card>
            </main>
        );
    }

    return (
        <main className="app-shell mx-auto min-h-screen w-full max-w-[1280px] p-4 md:p-6">
            <div className="grid min-h-[calc(100vh-2rem)] grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
                <Card className="overflow-hidden border-border/60 bg-card/70 shadow-2xl shadow-black/20 backdrop-blur-xl">
                    <CardHeader className="border-b border-border/60 bg-card/65">
                        <CardTitle>Conversations</CardTitle>
                        <CardDescription>Each conversation has isolated runtime state.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 p-3">
                        <Button
                            className="w-full"
                            onClick={() => {
                                createSession().catch((error) => {
                                    setErrorMessage(error instanceof Error ? error.message : "Failed to create session.");
                                });
                            }}
                        >
                            <FilePlus2 className="mr-2 h-4 w-4" /> New Conversation
                        </Button>

                        <div className="space-y-2">
                            {sessions.map((session) => (
                                <div
                                    key={session.sessionId}
                                    className={`rounded-lg border p-2 transition ${activeSessionId === session.sessionId ? "border-primary/80 bg-primary/10 shadow-lg shadow-primary/10" : "border-border/70 bg-background/35 hover:bg-background/55"}`}
                                >
                                    <button
                                        className="w-full text-left"
                                        onClick={() => {
                                            setActiveSessionId(session.sessionId);
                                        }}
                                    >
                                        <p className="truncate font-semibold">{session.name}</p>
                                        <p className="text-xs text-muted-foreground">{session.activeAgentName}</p>
                                        <div className="mt-1 flex items-center gap-2">
                                            {session.hasPendingToolRequest ? <Badge variant="destructive">Pending approval</Badge> : null}
                                            {session.continuousMode ? <Badge variant="secondary">Continuous</Badge> : null}
                                        </div>
                                    </button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="mt-2 w-full"
                                        onClick={() => {
                                            deleteSession(session.sessionId).catch((error) => {
                                                setErrorMessage(error instanceof Error ? error.message : "Failed to delete session.");
                                            });
                                        }}
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card className="flex min-h-[calc(100vh-2rem)] flex-col overflow-hidden border-border/60 bg-card/70 shadow-2xl shadow-black/20 backdrop-blur-xl">
                    <CardHeader className="border-b border-border/60 bg-card/65 backdrop-blur-xl">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <CardTitle>{sessionLabel}</CardTitle>
                                <CardDescription>Tools, approvals, and multi-agent routing are streamed live.</CardDescription>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 text-sm">
                                    <span>Continuous mode</span>
                                    <Switch
                                        checked={activeState?.continuousMode ?? false}
                                        onCheckedChange={(checked) => {
                                            setContinuousMode(Boolean(checked)).catch((error) => {
                                                setErrorMessage(error instanceof Error ? error.message : "Could not toggle continuous mode.");
                                            });
                                        }}
                                        disabled={!activeState}
                                    />
                                </label>

                                <select
                                    className="h-10 rounded-md border border-input bg-background/80 px-3 text-sm"
                                    value={activeState?.activeAgentName ?? ""}
                                    onChange={(event) => {
                                        setActiveAgent(event.target.value).catch((error) => {
                                            setErrorMessage(error instanceof Error ? error.message : "Could not change agent.");
                                        });
                                    }}
                                    disabled={!activeState}
                                >
                                    {(activeState?.agentNames ?? []).map((agentName) => (
                                        <option key={agentName} value={agentName}>
                                            {agentName}
                                        </option>
                                    ))}
                                </select>

                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        resetSession().catch((error) => {
                                            setErrorMessage(error instanceof Error ? error.message : "Could not reset session.");
                                        });
                                    }}
                                    disabled={!activeState}
                                >
                                    <RefreshCw className="mr-2 h-4 w-4" /> Reset
                                </Button>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="flex-1 space-y-3 overflow-y-auto p-4">
                        {activeEvents.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border/80 bg-background/40 p-6 text-center text-sm text-muted-foreground">
                                {activeSessionId ? "Send a message to begin." : "Create a conversation to begin."}
                            </div>
                        ) : null}

                        {activeEvents.map((event) => {
                            if (event.type === "state_changed") {
                                return null;
                            }

                            if (event.type === "user_message") {
                                return (
                                    <Card key={event.id} className="border-border/60 bg-background/45">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base">You</CardTitle>
                                            <CardDescription>{formatTime(event.timestamp)}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="whitespace-pre-wrap text-sm">{event.text || "(No text)"}</p>
                                            {event.workspaceFiles.length > 0 ? (
                                                <p className="mt-2 text-xs text-muted-foreground">Workspace files: {event.workspaceFiles.join(", ")}</p>
                                            ) : null}
                                            {event.chatImages.length > 0 ? (
                                                <p className="mt-1 text-xs text-muted-foreground">Chat images: {event.chatImages.join(", ")}</p>
                                            ) : null}
                                        </CardContent>
                                    </Card>
                                );
                            }

                            if (event.type === "tool_response") {
                                return (
                                    <Card key={event.id} className="border-cyan-400/35 bg-cyan-500/10">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base">
                                                Tool Response <span className="text-muted-foreground">[{event.agentName}]</span>
                                            </CardTitle>
                                            <CardDescription>
                                                {event.toolName} {event.toolCallId ? `(${event.toolCallId})` : ""}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <ScrollableCodeBlock text={event.response} />
                                        </CardContent>
                                    </Card>
                                );
                            }

                            if (event.type === "agent_to_agent") {
                                return (
                                    <Card key={event.id} className="border-emerald-400/35 bg-emerald-500/10">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base">Agent to Agent</CardTitle>
                                            <CardDescription>
                                                {event.sourceAgent} → {event.destinationAgent}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="whitespace-pre-wrap text-sm">{event.message}</p>
                                            {downloadLinks(event.attachments)}
                                        </CardContent>
                                    </Card>
                                );
                            }

                            if (event.type === "tool_request") {
                                const title = event.requiresApproval ? "Tool Approval Needed" : "Tool Call (Continuous Mode)";
                                const description = event.requiresApproval
                                    ? `Agent: ${event.payload.callingAgent}`
                                    : `Agent: ${event.payload.callingAgent} (auto-continued)`;
                                return (
                                    <Card key={event.id} className="border-amber-400/35 bg-amber-500/10">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base">{title}</CardTitle>
                                            <CardDescription>{description}</CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            <ScrollableCodeBlock text={event.payload.content} />
                                            <div className="space-y-2 rounded-md bg-background p-3">
                                                {event.payload.toolCalls.map((call, index) => (
                                                    <div key={`${event.id}-${index}`} className="space-y-1 border-b border-border pb-2 last:border-b-0 last:pb-0">
                                                        <p className="text-sm font-semibold">{call.toolName}</p>
                                                        <ScrollableCodeBlock text={call.input} />
                                                    </div>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            }

                            if (event.type === "agent_response") {
                                return (
                                    <Card key={event.id} className="border-border/60 bg-card/70">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base">{event.agentName}</CardTitle>
                                            <CardDescription>{formatTime(event.timestamp)}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-foreground">
                                                {event.markdown}
                                            </ReactMarkdown>
                                            {downloadLinks(event.attachments)}
                                        </CardContent>
                                    </Card>
                                );
                            }

                            if (event.type === "reset") {
                                return (
                                    <Card key={event.id} className="border-lime-400/35 bg-lime-500/10">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base">Reset</CardTitle>
                                        </CardHeader>
                                        <CardContent>{event.message}</CardContent>
                                    </Card>
                                );
                            }

                            return (
                                <Card key={event.id} className="border-destructive/30 bg-destructive/5">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base">Error</CardTitle>
                                        <CardDescription>{event.code ?? "UNKNOWN_ERROR"}</CardDescription>
                                    </CardHeader>
                                    <CardContent>{event.message}</CardContent>
                                </Card>
                            );
                        })}
                    </CardContent>

                    <div className="border-t border-border/60 bg-card/70 p-4">
                        {pendingToolRequest ? (
                            <div className="mb-4 rounded-md border border-amber-400/45 bg-amber-500/12 p-3">
                                <p className="text-sm font-semibold">Tool request is waiting for your decision.</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <Button
                                        onClick={() => {
                                            submitApproval("approve").catch((error) => {
                                                setErrorMessage(error instanceof Error ? error.message : "Approval failed.");
                                            });
                                        }}
                                        disabled={isSubmitting}
                                    >
                                        Approve
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        onClick={() => {
                                            setShowDisapproveBox((current) => !current);
                                        }}
                                        disabled={isSubmitting}
                                    >
                                        Disapprove
                                    </Button>
                                </div>

                                {showDisapproveBox ? (
                                    <div className="mt-3 space-y-2">
                                        <Textarea
                                            value={disapproveMessage}
                                            onChange={(event) => {
                                                setDisapproveMessage(event.target.value);
                                            }}
                                            placeholder="Explain why this tool execution should not run..."
                                        />
                                        <Button
                                            variant="destructive"
                                            onClick={() => {
                                                submitApproval("disapprove").catch((error) => {
                                                    setErrorMessage(error instanceof Error ? error.message : "Disapproval failed.");
                                                });
                                            }}
                                            disabled={isSubmitting}
                                        >
                                            Send Disapproval Message
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        <div className="space-y-3">
                            <div
                                onDragEnter={handleComposerDragEnter}
                                onDragOver={handleComposerDragOver}
                                onDragLeave={handleComposerDragLeave}
                                onDrop={handleComposerDrop}
                                className={`rounded-md border transition ${isComposerDragOver ? "border-primary bg-primary/10 shadow-lg shadow-primary/20" : "border-border/70 bg-background/45"}`}
                            >
                                <Textarea
                                    value={message}
                                    onChange={(event) => {
                                        setMessage(event.target.value);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                                            return;
                                        }

                                        event.preventDefault();
                                        if (disableComposer || !activeSessionId) {
                                            return;
                                        }

                                        sendMessage().catch((error) => {
                                            setErrorMessage(error instanceof Error ? error.message : "Failed to send message.");
                                        });
                                    }}
                                    placeholder="Send a message to your active agent... (drag files into this box to attach)"
                                    disabled={disableComposer || !activeSessionId}
                                    className="min-h-24 border-0 bg-transparent shadow-none focus-visible:ring-0"
                                />
                                <div className="border-t border-border px-3 py-2">
                                    <p className="text-xs text-muted-foreground">
                                        Drag files here to attach. Image files are also sent as chat images.
                                    </p>
                                    {attachedFiles.length > 0 ? (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {attachedFiles.map((file, index) => {
                                                const fingerprint = fileFingerprint(file);
                                                return (
                                                    <div
                                                        key={`${fingerprint}-${index}`}
                                                        className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs"
                                                    >
                                                        <span className="max-w-[220px] truncate">{file.name}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                removeAttachedFile(fingerprint);
                                                            }}
                                                            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                                            aria-label={`Remove ${file.name}`}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            {errorMessage ? (
                                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</div>
                            ) : null}

                            <div className="flex items-center justify-end">
                                <Button
                                    onClick={() => {
                                        sendMessage().catch((error) => {
                                            setErrorMessage(error instanceof Error ? error.message : "Failed to send message.");
                                        });
                                    }}
                                    disabled={!activeSessionId || disableComposer}
                                >
                                    <SendHorizontal className="mr-2 h-4 w-4" /> Send
                                </Button>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        </main>
    );
}
