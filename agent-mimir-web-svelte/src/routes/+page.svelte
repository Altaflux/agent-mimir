
<script lang="ts">
    import { FilePlus2, RefreshCw, SendHorizontal, Trash2, X } from "lucide-svelte";
    import { marked } from "marked";
    import type {
        ApprovalRequest,
        CreateSessionResponse,
        ListSessionsResponse,
        SessionEvent,
        SessionState,
        SessionSummary,
        SetActiveAgentResponse,
        ToggleContinuousModeResponse
    } from "@/lib/contracts";

    type EventMap = Record<string, SessionEvent[]>;
    type StateMap = Record<string, SessionState>;
    type ErrorPayload = { error?: { code?: string; message?: string } };

    const CHAT_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);
    const CHAT_MARKDOWN_CLASS =
        "prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-foreground " +
        "prose-headings:my-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 " +
        "prose-pre:my-2 prose-pre:max-h-56 prose-pre:overflow-auto prose-code:before:content-none prose-code:after:content-none";

    let sessions = $state<SessionSummary[]>([]);
    let sessionStates = $state<StateMap>({});
    let eventsBySession = $state<EventMap>({});
    let activeSessionId = $state<string | null>(null);
    let message = $state("");
    let attachedFiles = $state<File[]>([]);
    let isComposerDragOver = $state(false);
    let isLoading = $state(true);
    let isSubmitting = $state(false);
    let disapproveMessage = $state("");
    let showDisapproveBox = $state(false);
    let errorMessage = $state<string | null>(null);
    let initialized = $state(false);

    let dragDepth = 0;

    const activeState = $derived(activeSessionId ? sessionStates[activeSessionId] : undefined);
    const activeEvents = $derived(activeSessionId ? (eventsBySession[activeSessionId] ?? []) : []);
    const pendingToolRequest = $derived(activeState?.pendingToolRequest);
    const disableComposer = $derived(isSubmitting || Boolean(pendingToolRequest));
    const sessionLabel = $derived(activeState ? `${activeState.name} (${activeState.activeAgentName})` : "No active conversation");

    function buttonClass(
        variant: "default" | "secondary" | "outline" | "ghost" | "destructive" = "default",
        size: "default" | "sm" | "lg" | "icon" = "default",
        extra = ""
    ): string {
        const base =
            "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold transition-colors " +
            "disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 " +
            "focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background";

        const variantClass = {
            default: "bg-primary text-primary-foreground hover:bg-primary/90",
            secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
            ghost: "hover:bg-accent hover:text-accent-foreground",
            destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
        }[variant];

        const sizeClass = {
            default: "h-10 px-4 py-2",
            sm: "h-9 rounded-md px-3",
            lg: "h-11 rounded-md px-6",
            icon: "h-10 w-10"
        }[size];

        return `${base} ${variantClass} ${sizeClass} ${extra}`.trim();
    }

    function cardClass(extra = ""): string {
        return `rounded-xl border bg-card text-card-foreground shadow-sm ${extra}`.trim();
    }

    function formatTime(iso: string): string {
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

    function renderMarkdown(markdown: string): string {
        return String(marked.parse(markdown, { gfm: true, breaks: false }));
    }

    function isChatImageFile(file: File): boolean {
        return CHAT_IMAGE_MIME_TYPES.has(file.type.toLowerCase());
    }

    function fileFingerprint(file: File): string {
        return `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
    }

    function upsertSessionSummary(summary: SessionSummary) {
        const next = [...sessions.filter((entry) => entry.sessionId !== summary.sessionId), summary];
        next.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
        sessions = next;
    }

    function upsertSessionState(state: SessionState) {
        sessionStates = { ...sessionStates, [state.sessionId]: state };
        upsertSessionSummary(state);
    }
    function appendEvent(event: SessionEvent) {
        const existing = eventsBySession[event.sessionId] ?? [];

        if (event.type === "agent_response_chunk") {
            if (existing.some((entry) => entry.type === "agent_response" && entry.messageId === event.messageId)) {
                return;
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
                eventsBySession = { ...eventsBySession, [event.sessionId]: mergedEvents };
                return;
            }

            eventsBySession = { ...eventsBySession, [event.sessionId]: [...existing, event] };
            return;
        }

        if (event.type === "agent_response") {
            const withoutRelatedChunks = existing.filter(
                (entry) => !(entry.type === "agent_response_chunk" && entry.messageId === event.messageId)
            );
            if (withoutRelatedChunks.some((entry) => entry.id === event.id)) {
                return;
            }

            eventsBySession = {
                ...eventsBySession,
                [event.sessionId]: [...withoutRelatedChunks, event]
            };
            return;
        }

        if (event.type === "agent_to_agent") {
            const withoutRelatedChunks = event.messageId
                ? existing.filter((entry) => !(entry.type === "agent_response_chunk" && entry.messageId === event.messageId))
                : existing;

            if (withoutRelatedChunks.some((entry) => entry.id === event.id)) {
                return;
            }

            eventsBySession = {
                ...eventsBySession,
                [event.sessionId]: [...withoutRelatedChunks, event]
            };
            return;
        }

        if (existing.some((entry) => entry.id === event.id)) {
            return;
        }

        eventsBySession = { ...eventsBySession, [event.sessionId]: [...existing, event] };

        if (event.type === "state_changed") {
            upsertSessionState(event.state);
        }
    }

    async function createSession(name?: string): Promise<SessionState> {
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
        activeSessionId = success.session.sessionId;
        return success.session;
    }

    async function refreshSessions(): Promise<SessionSummary[]> {
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
        sessions = success.sessions;
        const validIds = new Set(success.sessions.map((entry) => entry.sessionId));

        const nextStates: StateMap = {};
        for (const [sessionId, state] of Object.entries(sessionStates)) {
            if (validIds.has(sessionId)) {
                nextStates[sessionId] = state;
            }
        }
        sessionStates = nextStates;

        const nextEvents: EventMap = {};
        for (const [sessionId, events] of Object.entries(eventsBySession)) {
            if (validIds.has(sessionId)) {
                nextEvents[sessionId] = events;
            }
        }
        eventsBySession = nextEvents;

        return success.sessions;
    }

    async function recoverFromMissingSession(missingSessionId: string): Promise<string | null> {
        const latestSessions = await refreshSessions();
        if (latestSessions.some((session) => session.sessionId === missingSessionId)) {
            return missingSessionId;
        }

        if (latestSessions.length === 0) {
            activeSessionId = null;
            errorMessage = `Session "${missingSessionId}" was not found. Create a new conversation.`;
            return null;
        }

        const fallback = latestSessions[0]!;
        activeSessionId = fallback.sessionId;
        errorMessage = `Session "${missingSessionId}" was not found. Switched to "${fallback.name}".`;
        return fallback.sessionId;
    }

    async function recoverFromSessionNotFoundResponse(sessionId: string, response: Response, payload: unknown): Promise<boolean> {
        if (response.status === 404 && apiErrorCode(payload) === "SESSION_NOT_FOUND") {
            await recoverFromMissingSession(sessionId);
            return true;
        }

        return false;
    }

    $effect(() => {
        if (typeof window === "undefined" || initialized) {
            return;
        }

        initialized = true;
        isLoading = true;

        void (async () => {
            try {
                const latestSessions = await refreshSessions();
                if (latestSessions.length === 0) {
                    activeSessionId = null;
                } else {
                    activeSessionId = activeSessionId && latestSessions.some((session) => session.sessionId === activeSessionId)
                        ? activeSessionId
                        : latestSessions[0]!.sessionId;
                }
            } catch (error) {
                errorMessage = error instanceof Error ? error.message : "Failed to initialize the chat.";
            } finally {
                isLoading = false;
            }
        })();
    });

    $effect.pre(() => {
        if (typeof window === "undefined") {
            return;
        }

        const sessionId = activeSessionId;
        if (!sessionId) {
            return;
        }

        const eventSource = new EventSource(`/api/sessions/${sessionId}/stream`);

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
            void recoverFromMissingSession(sessionId).catch((error) => {
                errorMessage = error instanceof Error ? error.message : "Failed to recover session state.";
            });
        };

        return () => {
            eventSource.close();
        };
    });
    async function sendMessage() {
        if (!activeSessionId || isSubmitting) {
            return;
        }

        if (message.trim().length === 0 && attachedFiles.length === 0) {
            errorMessage = "Write a message or attach files before sending.";
            return;
        }

        errorMessage = null;
        isSubmitting = true;

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

            message = "";
            attachedFiles = [];
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : "Message failed.";
        } finally {
            isSubmitting = false;
        }
    }

    async function submitApproval(action: ApprovalRequest["action"]) {
        if (!activeSessionId) {
            return;
        }

        if (action === "disapprove" && disapproveMessage.trim().length === 0) {
            errorMessage = "Disapproval requires a feedback message.";
            return;
        }

        errorMessage = null;
        isSubmitting = true;

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

            disapproveMessage = "";
            showDisapproveBox = false;
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : "Approval request failed.";
        } finally {
            isSubmitting = false;
        }
    }

    async function setContinuousMode(enabled: boolean) {
        if (!activeSessionId) {
            return;
        }

        errorMessage = null;

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
            errorMessage = error instanceof Error ? error.message : "Failed to set continuous mode.";
        }
    }

    async function setActiveAgent(agentName: string) {
        if (!activeSessionId) {
            return;
        }

        errorMessage = null;

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
            errorMessage = error instanceof Error ? error.message : "Failed to switch active agent.";
        }
    }

    async function resetSession() {
        if (!activeSessionId) {
            return;
        }

        errorMessage = null;

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
            errorMessage = error instanceof Error ? error.message : "Failed to reset session.";
        }
    }

    async function deleteSession(sessionId: string) {
        errorMessage = null;

        try {
            const response = await fetch(`/api/sessions/${sessionId}`, {
                method: "DELETE"
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(apiErrorMessage(payload, "Failed to delete session."));
            }

            const remaining = sessions.filter((entry) => entry.sessionId !== sessionId);
            sessions = remaining;

            const { [sessionId]: _removedState, ...restStates } = sessionStates;
            sessionStates = restStates;

            const { [sessionId]: _removedEvents, ...restEvents } = eventsBySession;
            eventsBySession = restEvents;

            if (activeSessionId === sessionId) {
                activeSessionId = remaining.length > 0 ? remaining[0]!.sessionId : null;
            }
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : "Failed to delete session.";
        }
    }

    function addDroppedFiles(incomingFiles: File[]) {
        if (incomingFiles.length === 0) {
            return;
        }

        const existingFingerprints = new Set(attachedFiles.map((file) => fileFingerprint(file)));
        const uniqueIncoming = incomingFiles.filter((file) => !existingFingerprints.has(fileFingerprint(file)));
        attachedFiles = [...attachedFiles, ...uniqueIncoming];
    }

    function removeAttachedFile(fingerprint: string) {
        let removed = false;
        attachedFiles = attachedFiles.filter((file) => {
            if (!removed && fileFingerprint(file) === fingerprint) {
                removed = true;
                return false;
            }

            return true;
        });
    }

    function handleComposerDragEnter(event: DragEvent) {
        event.preventDefault();
        if (disableComposer || !activeSessionId) {
            return;
        }

        if (!event.dataTransfer?.types.includes("Files")) {
            return;
        }

        dragDepth += 1;
        isComposerDragOver = true;
    }

    function handleComposerDragOver(event: DragEvent) {
        event.preventDefault();

        if (disableComposer || !activeSessionId) {
            return;
        }

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    }

    function handleComposerDragLeave(event: DragEvent) {
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) {
            isComposerDragOver = false;
        }
    }

    function handleComposerDrop(event: DragEvent) {
        event.preventDefault();
        dragDepth = 0;
        isComposerDragOver = false;

        if (disableComposer || !activeSessionId) {
            return;
        }

        addDroppedFiles(Array.from(event.dataTransfer?.files ?? []));
    }
</script>
{#if isLoading}
    <main class="app-shell mx-auto flex min-h-screen w-full max-w-[1280px] items-center justify-center p-6">
        <div class={cardClass("w-full max-w-md border-border/60 bg-card/75 shadow-2xl shadow-black/30 backdrop-blur-xl")}>
            <div class="flex flex-col space-y-1.5 p-4">
                <h3 class="font-heading text-lg font-semibold leading-none tracking-tight">Loading Agent Mimir Web</h3>
                <p class="text-sm text-muted-foreground">Preparing your session runtime.</p>
            </div>
        </div>
    </main>
{:else}
    <main class="app-shell mx-auto min-h-screen w-full max-w-[1280px] p-4 md:p-6">
        <div class="grid min-h-[calc(100vh-2rem)] grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
            <div class={cardClass("overflow-hidden border-border/60 bg-card/70 shadow-2xl shadow-black/20 backdrop-blur-xl")}>
                <div class="flex flex-col space-y-1.5 border-b border-border/60 bg-card/65 p-4">
                    <h3 class="font-heading text-lg font-semibold leading-none tracking-tight">Conversations</h3>
                    <p class="text-sm text-muted-foreground">Each conversation has isolated runtime state.</p>
                </div>
                <div class="space-y-3 p-3">
                    <button
                        class={buttonClass("default", "default", "w-full")}
                        onclick={() => {
                            void createSession().catch((error) => {
                                errorMessage = error instanceof Error ? error.message : "Failed to create session.";
                            });
                        }}
                    >
                        <FilePlus2 class="mr-2 h-4 w-4" /> New Conversation
                    </button>

                    <div class="space-y-2">
                        {#each sessions as session (session.sessionId)}
                            <div
                                class={`rounded-lg border p-2 transition ${
                                    activeSessionId === session.sessionId
                                        ? "border-primary/80 bg-primary/10 shadow-lg shadow-primary/10"
                                        : "border-border/70 bg-background/35 hover:bg-background/55"
                                }`}
                            >
                                <button
                                    class="w-full text-left"
                                    onclick={() => {
                                        activeSessionId = session.sessionId;
                                    }}
                                >
                                    <p class="truncate font-semibold">{session.name}</p>
                                    <p class="text-xs text-muted-foreground">{session.activeAgentName}</p>
                                    <div class="mt-1 flex items-center gap-2">
                                        {#if session.hasPendingToolRequest}
                                            <span class="inline-flex items-center rounded-full border border-transparent bg-destructive px-2.5 py-0.5 text-xs font-semibold text-destructive-foreground">Pending approval</span>
                                        {/if}
                                        {#if session.continuousMode}
                                            <span class="inline-flex items-center rounded-full border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">Continuous</span>
                                        {/if}
                                    </div>
                                </button>
                                <button
                                    class={buttonClass("ghost", "sm", "mt-2 w-full")}
                                    onclick={() => {
                                        void deleteSession(session.sessionId).catch((error) => {
                                            errorMessage = error instanceof Error ? error.message : "Failed to delete session.";
                                        });
                                    }}
                                >
                                    <Trash2 class="mr-2 h-4 w-4" /> Delete
                                </button>
                            </div>
                        {/each}
                    </div>
                </div>
            </div>

            <div class={cardClass("flex min-h-[calc(100vh-2rem)] flex-col overflow-hidden border-border/60 bg-card/70 shadow-2xl shadow-black/20 backdrop-blur-xl")}>
                <div class="border-b border-border/60 bg-card/65 p-4 backdrop-blur-xl">
                    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 class="font-heading text-lg font-semibold leading-none tracking-tight">{sessionLabel}</h3>
                            <p class="text-sm text-muted-foreground">Tools, approvals, and multi-agent routing are streamed live.</p>
                        </div>

                        <div class="flex flex-wrap items-center gap-3">
                            <label class="flex items-center gap-2 text-sm">
                                <span>Continuous mode</span>
                                <span class="relative inline-flex h-6 w-11 items-center">
                                    <input
                                        type="checkbox"
                                        class="peer sr-only"
                                        checked={activeState?.continuousMode ?? false}
                                        disabled={!activeState}
                                        onchange={(event) => {
                                            const checked = (event.currentTarget as HTMLInputElement).checked;
                                            void setContinuousMode(Boolean(checked)).catch((error) => {
                                                errorMessage = error instanceof Error ? error.message : "Could not toggle continuous mode.";
                                            });
                                        }}
                                    />
                                    <span class="h-6 w-11 rounded-full bg-input transition-colors peer-checked:bg-primary"></span>
                                    <span class="absolute left-0.5 h-5 w-5 rounded-full bg-background shadow-lg transition-transform peer-checked:translate-x-5"></span>
                                </span>
                            </label>

                            <select
                                class="h-10 rounded-md border border-input bg-background/80 px-3 text-sm"
                                value={activeState?.activeAgentName ?? ""}
                                disabled={!activeState}
                                onchange={(event) => {
                                    const nextAgent = (event.currentTarget as HTMLSelectElement).value;
                                    void setActiveAgent(nextAgent).catch((error) => {
                                        errorMessage = error instanceof Error ? error.message : "Could not change agent.";
                                    });
                                }}
                            >
                                {#each activeState?.agentNames ?? [] as agentName (agentName)}
                                    <option value={agentName}>{agentName}</option>
                                {/each}
                            </select>

                            <button
                                class={buttonClass("outline", "default")}
                                disabled={!activeState}
                                onclick={() => {
                                    void resetSession().catch((error) => {
                                        errorMessage = error instanceof Error ? error.message : "Could not reset session.";
                                    });
                                }}
                            >
                                <RefreshCw class="mr-2 h-4 w-4" /> Reset
                            </button>
                        </div>
                    </div>
                </div>

                <div class="flex-1 space-y-3 overflow-y-auto p-4">
                    {#if activeEvents.length === 0}
                        <div class="rounded-lg border border-dashed border-border/80 bg-background/40 p-6 text-center text-sm text-muted-foreground">
                            {activeSessionId ? "Send a message to begin." : "Create a conversation to begin."}
                        </div>
                    {/if}

                    {#each activeEvents as event (event.id)}
                        {#if event.type === "state_changed"}
                            <span class="hidden"></span>
                        {:else if event.type === "user_message"}
                            <div class={cardClass("border-border/60 bg-background/45")}>
                                <div class="flex flex-col space-y-1.5 p-4 pb-2">
                                    <h3 class="font-heading text-base font-semibold leading-none tracking-tight">You</h3>
                                    <p class="text-sm text-muted-foreground">{formatTime(event.timestamp)}</p>
                                </div>
                                <div class="p-4 pt-0">
                                    <p class="whitespace-pre-wrap text-sm">{event.text || "(No text)"}</p>
                                    {#if event.workspaceFiles.length > 0}
                                        <p class="mt-2 text-xs text-muted-foreground">Workspace files: {event.workspaceFiles.join(", ")}</p>
                                    {/if}
                                    {#if event.chatImages.length > 0}
                                        <p class="mt-1 text-xs text-muted-foreground">Chat images: {event.chatImages.join(", ")}</p>
                                    {/if}
                                </div>
                            </div>
                        {:else if event.type === "tool_response"}
                            <div class={cardClass("border-cyan-400/35 bg-cyan-500/10")}>
                                <div class="flex flex-col space-y-1.5 p-4 pb-2">
                                    <h3 class="font-heading text-base font-semibold leading-none tracking-tight">
                                        Tool Response <span class="text-muted-foreground">[{event.agentName}]</span>
                                    </h3>
                                    <p class="text-sm text-muted-foreground">{event.toolName} {event.toolCallId ? `(${event.toolCallId})` : ""}</p>
                                </div>
                                <div class="p-4 pt-0">
                                    <pre class="max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-background/70 p-3 text-xs text-foreground/90">{event.response}</pre>
                                </div>
                            </div>
                        {:else if event.type === "agent_to_agent"}
                            <div class={cardClass("border-emerald-400/35 bg-emerald-500/10")}>
                                <div class="flex flex-col space-y-1.5 p-4 pb-2">
                                    <h3 class="font-heading text-base font-semibold leading-none tracking-tight">Agent to Agent</h3>
                                    <p class="text-sm text-muted-foreground">{event.sourceAgent} → {event.destinationAgent}</p>
                                </div>
                                <div class="p-4 pt-0">
                                    <div class={CHAT_MARKDOWN_CLASS}>
                                        {@html renderMarkdown(event.message)}
                                    </div>
                                    {#if event.attachments.length > 0}
                                        <div class="mt-2 flex flex-wrap gap-2">
                                            {#each event.attachments as file (file.fileId)}
                                                <a
                                                    href={file.href}
                                                    class="rounded-full border border-border bg-background px-3 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
                                                >
                                                    {file.fileName}
                                                </a>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {:else if event.type === "tool_request"}
                            <div class={cardClass("border-amber-400/35 bg-amber-500/10")}>
                                <div class="flex flex-col space-y-1.5 p-4 pb-2">
                                    <h3 class="font-heading text-base font-semibold leading-none tracking-tight">
                                        {event.requiresApproval ? "Tool Approval Needed" : "Tool Call (Continuous Mode)"}
                                    </h3>
                                    <p class="text-sm text-muted-foreground">
                                        {event.requiresApproval
                                            ? `Agent: ${event.payload.callingAgent}`
                                            : `Agent: ${event.payload.callingAgent} (auto-continued)`}
                                    </p>
                                </div>
                                <div class="space-y-3 p-4 pt-0">
                                    <pre class="max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-background/70 p-3 text-xs text-foreground/90">{event.payload.content}</pre>
                                    <div class="space-y-2 rounded-md bg-background p-3">
                                        {#each event.payload.toolCalls as call, index (`${event.id}-${index}`)}
                                            <div class="space-y-1 border-b border-border pb-2 last:border-b-0 last:pb-0">
                                                <p class="text-sm font-semibold">{call.toolName}</p>
                                                <pre class="max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-background/70 p-3 text-xs text-foreground/90">{call.input}</pre>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            </div>
                        {:else if event.type === "agent_response"}
                            <div class={cardClass("border-border/60 bg-card/70")}>
                                <div class="flex flex-col space-y-1.5 p-4 pb-2">
                                    <h3 class="font-heading text-base font-semibold leading-none tracking-tight">{event.agentName}</h3>
                                    <p class="text-sm text-muted-foreground">{formatTime(event.timestamp)}</p>
                                </div>
                                <div class="p-4 pt-0">
                                    <div class={CHAT_MARKDOWN_CLASS}>
                                        {@html renderMarkdown(event.markdown)}
                                    </div>
                                    {#if event.attachments.length > 0}
                                        <div class="mt-2 flex flex-wrap gap-2">
                                            {#each event.attachments as file (file.fileId)}
                                                <a
                                                    href={file.href}
                                                    class="rounded-full border border-border bg-background px-3 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
                                                >
                                                    {file.fileName}
                                                </a>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {:else if event.type === "agent_response_chunk"}
                            <div class={cardClass("border-primary/35 bg-primary/10")}>
                                <div class="flex flex-col space-y-1.5 p-4 pb-2">
                                    <h3 class="font-heading text-base font-semibold leading-none tracking-tight">{event.agentName} (typing)</h3>
                                    <p class="text-sm text-muted-foreground">{formatTime(event.timestamp)}</p>
                                </div>
                                <div class="p-4 pt-0">
                                    <div class={CHAT_MARKDOWN_CLASS}>
                                        {@html renderMarkdown(event.markdownChunk)}
                                    </div>
                                </div>
                            </div>
                        {:else if event.type === "reset"}
                            <div class={cardClass("border-lime-400/35 bg-lime-500/10")}>
                                <div class="flex flex-col space-y-1.5 p-4 pb-2">
                                    <h3 class="font-heading text-base font-semibold leading-none tracking-tight">Reset</h3>
                                </div>
                                <div class="p-4 pt-0">{event.message}</div>
                            </div>
                        {:else}
                            <div class={cardClass("border-destructive/30 bg-destructive/5")}>
                                <div class="flex flex-col space-y-1.5 p-4 pb-2">
                                    <h3 class="font-heading text-base font-semibold leading-none tracking-tight">Error</h3>
                                    <p class="text-sm text-muted-foreground">{event.code ?? "UNKNOWN_ERROR"}</p>
                                </div>
                                <div class="p-4 pt-0">{event.message}</div>
                            </div>
                        {/if}
                    {/each}
                </div>

                <div class="border-t border-border/60 bg-card/70 p-4">
                    {#if pendingToolRequest}
                        <div class="mb-4 rounded-md border border-amber-400/45 bg-amber-500/12 p-3">
                            <p class="text-sm font-semibold">Tool request is waiting for your decision.</p>
                            <div class="mt-3 flex flex-wrap gap-2">
                                <button
                                    class={buttonClass("default", "default")}
                                    disabled={isSubmitting}
                                    onclick={() => {
                                        void submitApproval("approve").catch((error) => {
                                            errorMessage = error instanceof Error ? error.message : "Approval failed.";
                                        });
                                    }}
                                >
                                    Approve
                                </button>
                                <button
                                    class={buttonClass("destructive", "default")}
                                    disabled={isSubmitting}
                                    onclick={() => {
                                        showDisapproveBox = !showDisapproveBox;
                                    }}
                                >
                                    Disapprove
                                </button>
                            </div>

                            {#if showDisapproveBox}
                                <div class="mt-3 space-y-2">
                                    <textarea
                                        class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        bind:value={disapproveMessage}
                                        placeholder="Explain why this tool execution should not run..."
                                    ></textarea>
                                    <button
                                        class={buttonClass("destructive", "default")}
                                        disabled={isSubmitting}
                                        onclick={() => {
                                            void submitApproval("disapprove").catch((error) => {
                                                errorMessage = error instanceof Error ? error.message : "Disapproval failed.";
                                            });
                                        }}
                                    >
                                        Send Disapproval Message
                                    </button>
                                </div>
                            {/if}
                        </div>
                    {/if}
                    <div class="space-y-3">
                        <div
                            role="region"
                            aria-label="Message composer"
                            ondragenter={handleComposerDragEnter}
                            ondragover={handleComposerDragOver}
                            ondragleave={handleComposerDragLeave}
                            ondrop={handleComposerDrop}
                            class={`rounded-md border transition ${
                                isComposerDragOver ? "border-primary bg-primary/10 shadow-lg shadow-primary/20" : "border-border/70 bg-background/45"
                            }`}
                        >
                            <textarea
                                class="min-h-24 w-full border-0 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground shadow-none focus-visible:outline-none"
                                bind:value={message}
                                placeholder="Send a message to your active agent... (drag files into this box to attach)"
                                disabled={disableComposer || !activeSessionId}
                                onkeydown={(event) => {
                                    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
                                        return;
                                    }

                                    event.preventDefault();
                                    if (disableComposer || !activeSessionId) {
                                        return;
                                    }

                                    void sendMessage().catch((error) => {
                                        errorMessage = error instanceof Error ? error.message : "Failed to send message.";
                                    });
                                }}
                            ></textarea>
                            <div class="border-t border-border px-3 py-2">
                                <p class="text-xs text-muted-foreground">Drag files here to attach. Image files are also sent as chat images.</p>
                                {#if attachedFiles.length > 0}
                                    <div class="mt-2 flex flex-wrap gap-2">
                                        {#each attachedFiles as file, index (`${fileFingerprint(file)}-${index}`)}
                                            <div class="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs">
                                                <span class="max-w-[220px] truncate">{file.name}</span>
                                                <button
                                                    type="button"
                                                    onclick={() => {
                                                        removeAttachedFile(fileFingerprint(file));
                                                    }}
                                                    class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                                    aria-label={`Remove ${file.name}`}
                                                >
                                                    <X class="h-3 w-3" />
                                                </button>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>

                        {#if errorMessage}
                            <div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</div>
                        {/if}

                        <div class="flex items-center justify-end">
                            <button
                                class={buttonClass("default", "default")}
                                disabled={!activeSessionId || disableComposer}
                                onclick={() => {
                                    void sendMessage().catch((error) => {
                                        errorMessage = error instanceof Error ? error.message : "Failed to send message.";
                                    });
                                }}
                            >
                                <SendHorizontal class="mr-2 h-4 w-4" /> Send
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </main>
{/if}

