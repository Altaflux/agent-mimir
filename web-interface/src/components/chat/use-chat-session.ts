"use client";

import {
    ApprovalRequest,
    CreateSessionResponse,
    ListSessionsResponse,
    SessionEvent,
    SessionState,
    SessionSummary,
    SetActiveAgentResponse,
    ToggleContinuousModeResponse
} from "@/lib/contracts";
import { apiErrorCode, apiErrorMessage, EventMap, isChatImageFile, StateMap } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Custom hook encapsulating all session and event state management.
 * Returns the state plus action callbacks for the UI to call.
 */
export function useChatSession() {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [sessionStates, setSessionStates] = useState<StateMap>({});
    const [eventsBySession, setEventsBySession] = useState<EventMap>({});
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const activeState = activeSessionId ? sessionStates[activeSessionId] : undefined;
    const activeEvents = activeSessionId ? eventsBySession[activeSessionId] ?? [] : [];

    /* ── Session helpers ─────────────────────────────── */

    const upsertSessionSummary = useCallback((summary: SessionSummary) => {
        setSessions((current) => {
            const next = [...current.filter((e) => e.sessionId !== summary.sessionId), summary];
            next.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
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
                    if (existing.some((e) => e.type === "agent_response" && e.messageId === event.messageId)) {
                        return current;
                    }
                    const idx = existing.findIndex(
                        (e) => e.type === "agent_response_chunk" && e.messageId === event.messageId
                    );
                    if (idx >= 0) {
                        const prev = existing[idx] as Extract<SessionEvent, { type: "agent_response_chunk" }>;
                        const merged: Extract<SessionEvent, { type: "agent_response_chunk" }> = {
                            ...prev,
                            id: event.id,
                            timestamp: event.timestamp,
                            markdownChunk: `${prev.markdownChunk}${event.markdownChunk}`
                        };
                        const events = [...existing];
                        events[idx] = merged;
                        return { ...current, [event.sessionId]: events };
                    }
                    return { ...current, [event.sessionId]: [...existing, event] };
                }

                if (event.type === "agent_response") {
                    const filtered = existing.filter(
                        (e) => !(e.type === "agent_response_chunk" && e.messageId === event.messageId)
                    );
                    if (filtered.some((e) => e.id === event.id)) return current;
                    return { ...current, [event.sessionId]: [...filtered, event] };
                }

                if (event.type === "agent_to_agent") {
                    const filtered = event.messageId
                        ? existing.filter((e) => !(e.type === "agent_response_chunk" && e.messageId === event.messageId))
                        : existing;
                    if (filtered.some((e) => e.id === event.id)) return current;
                    return { ...current, [event.sessionId]: [...filtered, event] };
                }

                if (event.type === "tool_response") {
                    const msgId = event.messageId;
                    const filtered = msgId
                        ? existing.filter((e) => !(e.type === "agent_response_chunk" && e.messageId === msgId))
                        : existing;
                    if (filtered.some((e) => e.id === event.id)) return current;
                    return { ...current, [event.sessionId]: [...filtered, event] };
                }

                if (event.type === "tool_request") {
                    let nextEvents = existing;
                    // Clear out the temporary chunks for this agent since the tool request marks the end of their message
                    const msgId = event.payload.messageId;
                    if (msgId) {
                        nextEvents = existing.filter(
                            (e) => !(e.type === "agent_response_chunk" && e.messageId === msgId)
                        );
                    } else {
                        nextEvents = existing.filter(
                            (e) => !(e.type === "agent_response_chunk" && e.agentName === event.payload.callingAgent)
                        );
                    }

                    // Synthesize an agent_response for the text strictly before the tool call so it persists across hydration!
                    if (event.payload.content && event.payload.content.trim().length > 0) {
                        const syntheticResponse: Extract<SessionEvent, { type: "agent_response" }> = {
                            id: `${event.id}_text`,
                            sessionId: event.sessionId,
                            timestamp: event.timestamp,
                            type: "agent_response",
                            agentName: event.payload.callingAgent,
                            messageId: msgId ?? `${event.id}_msg`,
                            markdown: event.payload.content,
                            attachments: []
                        };
                        nextEvents = [...nextEvents, syntheticResponse];
                    }

                    if (nextEvents.some((e) => e.id === event.id)) return current;
                    return { ...current, [event.sessionId]: [...nextEvents, event] };
                }

                if (existing.some((e) => e.id === event.id)) return current;
                return { ...current, [event.sessionId]: [...existing, event] };
            });

            if (event.type === "state_changed") {
                upsertSessionState(event.state);
            }
        },
        [upsertSessionState]
    );

    /* ── API calls ───────────────────────────────────── */

    const refreshSessions = useCallback(async () => {
        const response = await fetch("/api/sessions", {
            method: "GET",
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" }
        });
        const payload = (await response.json()) as ListSessionsResponse | { error?: { message?: string } };
        if (!response.ok) throw new Error(apiErrorMessage(payload, "Unable to load sessions."));

        const success = payload as ListSessionsResponse;
        setSessions(success.sessions);
        const validIds = new Set(success.sessions.map((e) => e.sessionId));
        setSessionStates((c) => {
            const next: StateMap = {};
            for (const [id, state] of Object.entries(c)) {
                if (validIds.has(id)) next[id] = state;
            }
            return next;
        });
        setEventsBySession((c) => {
            const next: EventMap = {};
            for (const [id, events] of Object.entries(c)) {
                if (validIds.has(id)) next[id] = events;
            }
            return next;
        });
        return success.sessions;
    }, []);

    const recoverFromMissingSession = useCallback(
        async (missingId: string) => {
            const latest = await refreshSessions();
            if (latest.some((s) => s.sessionId === missingId)) return missingId;
            if (latest.length === 0) {
                setActiveSessionId(null);
                setErrorMessage(`Session "${missingId}" was not found. Create a new conversation.`);
                return null;
            }
            const fallback = latest[0]!;
            setActiveSessionId(fallback.sessionId);
            setErrorMessage(`Session "${missingId}" was not found. Switched to "${fallback.name}".`);
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

    /* ── Initial load ────────────────────────────────── */

    useEffect(() => {
        (async () => {
            setIsLoading(true);
            try {
                const latest = await refreshSessions();
                if (latest.length === 0) {
                    setActiveSessionId(null);
                } else {
                    setActiveSessionId((c) =>
                        c && latest.some((s) => s.sessionId === c) ? c : latest[0]!.sessionId
                    );
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Failed to initialize the chat.");
            } finally {
                setIsLoading(false);
            }
        })();
    }, [refreshSessions]);

    /* ── SSE stream ──────────────────────────────────── */

    useEffect(() => {
        if (!activeSessionId) return;
        const eventSource = new EventSource(`/api/sessions/${activeSessionId}/stream`);

        eventSource.onmessage = (event) => {
            try {
                appendEvent(JSON.parse(event.data) as SessionEvent);
            } catch {
                return;
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
            recoverFromMissingSession(activeSessionId).catch((err) => {
                setErrorMessage(err instanceof Error ? err.message : "Failed to recover session state.");
            });
        };

        return () => eventSource.close();
    }, [activeSessionId, appendEvent, recoverFromMissingSession]);

    /* ── Action: create session ──────────────────────── */

    const createSession = useCallback(
        async (name?: string) => {
            const response = await fetch("/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name?.trim() || undefined })
            });
            const payload = (await response.json()) as CreateSessionResponse | { error?: { message?: string } };
            if (!response.ok) throw new Error(apiErrorMessage(payload, "Unable to create a new session."));
            const success = payload as CreateSessionResponse;
            upsertSessionState(success.session);
            setActiveSessionId(success.session.sessionId);
            return success.session;
        },
        [upsertSessionState]
    );

    /* ── Action: send message ────────────────────────── */

    const sendMessage = useCallback(
        async (text: string, files: File[]) => {
            if (!activeSessionId || isSubmitting) return;
            setErrorMessage(null);
            setIsSubmitting(true);
            try {
                const formData = new FormData();
                formData.append("message", text);
                for (const file of files) formData.append("workspaceFiles", file);
                for (const image of files.filter(isChatImageFile)) formData.append("chatImages", image);

                const response = await fetch(`/api/sessions/${activeSessionId}/message`, {
                    method: "POST",
                    body: formData
                });
                const payload = await response.json();
                if (!response.ok) {
                    if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) return;
                    throw new Error(apiErrorMessage(payload, "Message failed."));
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Message failed.");
            } finally {
                setIsSubmitting(false);
            }
        },
        [activeSessionId, isSubmitting, recoverFromSessionNotFoundResponse]
    );

    /* ── Action: approval ────────────────────────────── */

    const submitApproval = useCallback(
        async (action: ApprovalRequest["action"], feedback?: string) => {
            if (!activeSessionId) return;
            if (action === "disapprove" && (!feedback || feedback.trim().length === 0)) {
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
                        feedback: action === "disapprove" ? feedback : undefined
                    } satisfies ApprovalRequest)
                });
                const payload = await response.json();
                if (!response.ok) {
                    if (await recoverFromSessionNotFoundResponse(activeSessionId, response, payload)) return;
                    throw new Error(apiErrorMessage(payload, "Failed to submit approval."));
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Approval request failed.");
            } finally {
                setIsSubmitting(false);
            }
        },
        [activeSessionId, recoverFromSessionNotFoundResponse]
    );

    /* ── Action: continuous mode ─────────────────────── */

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
                upsertSessionState((payload as ToggleContinuousModeResponse).session);
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Failed to set continuous mode.");
            }
        },
        [activeSessionId, recoverFromSessionNotFoundResponse, upsertSessionState]
    );

    /* ── Action: set active agent ────────────────────── */

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
                upsertSessionState((payload as SetActiveAgentResponse).session);
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Failed to switch active agent.");
            }
        },
        [activeSessionId, recoverFromSessionNotFoundResponse, upsertSessionState]
    );

    /* ── Action: reset session ───────────────────────── */

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

    /* ── Action: delete session ──────────────────────── */

    const deleteSession = useCallback(
        async (sessionId: string) => {
            setErrorMessage(null);
            try {
                const response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
                const payload = await response.json();
                if (!response.ok) throw new Error(apiErrorMessage(payload, "Failed to delete session."));

                const remaining = sessions.filter((e) => e.sessionId !== sessionId);
                setSessions(remaining);
                setSessionStates((c) => {
                    const { [sessionId]: _, ...rest } = c;
                    return rest;
                });
                setEventsBySession((c) => {
                    const { [sessionId]: _, ...rest } = c;
                    return rest;
                });

                if (activeSessionId === sessionId) {
                    setActiveSessionId(remaining.length > 0 ? remaining[0]!.sessionId : null);
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Failed to delete session.");
            }
        },
        [activeSessionId, sessions]
    );

    /* ── Computed ─────────────────────────────────────── */

    const sessionLabel = useMemo(() => {
        if (!activeState) return "Agent Mimir";
        return activeState.name;
    }, [activeState]);

    const pendingToolRequest = activeState?.pendingToolRequest;
    const hasPendingToolRequest = Boolean(pendingToolRequest);

    const isAgentThinking = useMemo(() => {
        if (!isSubmitting && activeEvents.length > 0) {
            const last = activeEvents[activeEvents.length - 1];
            if (last && last.type === "user_message") return true;
        }
        return isSubmitting;
    }, [isSubmitting, activeEvents]);

    return {
        /* State */
        sessions,
        activeSessionId,
        activeState,
        activeEvents,
        isLoading,
        isSubmitting,
        errorMessage,
        sessionLabel,
        isAgentThinking,
        hasPendingToolRequest,

        /* Actions */
        setActiveSessionId,
        setErrorMessage,
        createSession,
        sendMessage,
        submitApproval,
        setContinuousMode,
        setActiveAgent,
        resetSession,
        deleteSession
    };
}
