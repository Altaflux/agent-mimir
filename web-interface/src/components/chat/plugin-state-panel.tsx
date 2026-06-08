"use client";

import { MarkdownContent } from "@/components/chat/markdown";
import { CopyButton } from "@/components/chat/shared";
import { formatTime } from "@/lib/api";
import type {
    GetPluginStateResponse,
    PluginStateDetail,
    PluginStateSummary,
} from "@/lib/contracts";
import {
    Maximize2,
    Minimize2,
    PanelRightClose,
    Puzzle,
    RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type PluginStatePanelProps = {
    sessionId: string | null;
    states: PluginStateSummary[];
    open: boolean;
    onClose: () => void;
};

export function PluginStatePanel({
    sessionId,
    states,
    open,
    onClose,
}: PluginStatePanelProps) {
    const [detailsByInstance, setDetailsByInstance] = useState<
        Record<string, PluginStateDetail>
    >({});
    const [loadingByInstance, setLoadingByInstance] = useState<
        Record<string, boolean>
    >({});
    const [errorsByInstance, setErrorsByInstance] = useState<
        Record<string, string>
    >({});
    const [expandedPluginInstanceId, setExpandedPluginInstanceId] = useState<
        string | null
    >(null);

    const stateKey = useMemo(
        () =>
            states
                .map((state) => `${state.pluginInstanceId}:${state.revision}`)
                .join("|"),
        [states],
    );
    const duplicatePluginNames = useMemo(() => {
        const counts = new Map<string, number>();
        for (const state of states) {
            counts.set(
                state.pluginName,
                (counts.get(state.pluginName) ?? 0) + 1,
            );
        }
        return new Set(
            [...counts.entries()]
                .filter(([, count]) => count > 1)
                .map(([pluginName]) => pluginName),
        );
    }, [states]);
    const expandedState = expandedPluginInstanceId
        ? (states.find(
              (state) => state.pluginInstanceId === expandedPluginInstanceId,
          ) ?? null)
        : null;
    const expandedDetail = expandedState
        ? detailsByInstance[expandedState.pluginInstanceId]
        : undefined;
    const expandedError = expandedState
        ? errorsByInstance[expandedState.pluginInstanceId]
        : undefined;
    const expandedLoading = expandedState
        ? loadingByInstance[expandedState.pluginInstanceId]
        : false;

    const formatStateLabel = (state: PluginStateSummary) =>
        duplicatePluginNames.has(state.pluginName)
            ? `${state.pluginName} ${state.pluginInstanceId.slice(0, 8)}`
            : state.pluginName;

    const formatStateSubtitle = (state: PluginStateSummary) => {
        const parts = [state.agentName];
        if (duplicatePluginNames.has(state.pluginName)) {
            parts.push(state.pluginInstanceId.slice(0, 8));
        }
        parts.push(formatTime(state.updatedAt));
        return parts.join(" · ");
    };

    useEffect(() => {
        setDetailsByInstance({});
        setLoadingByInstance({});
        setErrorsByInstance({});
        setExpandedPluginInstanceId(null);
    }, [sessionId]);

    useEffect(() => {
        if (
            expandedPluginInstanceId &&
            !states.some(
                (state) => state.pluginInstanceId === expandedPluginInstanceId,
            )
        ) {
            setExpandedPluginInstanceId(null);
        }
    }, [expandedPluginInstanceId, states]);

    useEffect(() => {
        if (!open || !sessionId) {
            return;
        }

        const pluginInstanceIds = new Set(
            states.map((state) => state.pluginInstanceId),
        );
        setDetailsByInstance((current) => {
            const next: Record<string, PluginStateDetail> = {};
            for (const [pluginInstanceId, detail] of Object.entries(current)) {
                if (pluginInstanceIds.has(pluginInstanceId)) {
                    next[pluginInstanceId] = detail;
                }
            }
            return next;
        });

        let cancelled = false;
        for (const state of states) {
            setLoadingByInstance((current) => ({
                ...current,
                [state.pluginInstanceId]: true,
            }));
            fetch(
                `/api/sessions/${sessionId}/plugin-states/${encodeURIComponent(state.pluginInstanceId)}`,
                {
                method: "GET",
                cache: "no-store",
                    headers: { "Cache-Control": "no-cache" },
                },
            )
                .then(async (response) => {
                    const payload = (await response.json()) as
                        | GetPluginStateResponse
                        | { error?: { message?: string } };
                    if (!response.ok) {
                        throw new Error(
                            payload.error?.message ??
                                "Unable to load plugin state.",
                        );
                    }
                    return (payload as GetPluginStateResponse).state;
                })
                .then((detail) => {
                    if (cancelled) return;
                    setDetailsByInstance((current) => ({
                        ...current,
                        [detail.pluginInstanceId]: detail,
                    }));
                    setErrorsByInstance((current) => {
                        const { [detail.pluginInstanceId]: _removed, ...rest } =
                            current;
                        return rest;
                    });
                })
                .catch((error) => {
                    if (cancelled) return;
                    setErrorsByInstance((current) => ({
                        ...current,
                        [state.pluginInstanceId]:
                            error instanceof Error
                                ? error.message
                                : "Unable to load plugin state.",
                    }));
                })
                .finally(() => {
                    if (cancelled) return;
                    setLoadingByInstance((current) => ({
                        ...current,
                        [state.pluginInstanceId]: false,
                    }));
                });
        }

        return () => {
            cancelled = true;
        };
    }, [open, sessionId, stateKey, states]);

    if (!open) {
        return null;
    }

    const panelWidthClass = expandedState
        ? "w-[min(44rem,calc(100vw-1rem))] md:w-[48vw] xl:w-[44rem]"
        : "w-[min(24rem,calc(100vw-2rem))] md:w-80";

    return (
        <aside
            className={`absolute right-0 top-0 z-30 flex h-full ${panelWidthClass} flex-col border-l border-border/40 bg-background shadow-2xl transition-[width] duration-200 md:relative md:z-auto md:shadow-none`}
        >
            <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2.5">
                <Puzzle className="h-4 w-4 text-cyan-500" />
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-foreground">
                        Plugin state
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        {states.length === 1
                            ? "1 active plugin"
                            : `${states.length} active plugins`}
                    </p>
                </div>
                <button
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => {
                        setExpandedPluginInstanceId(null);
                        onClose();
                    }}
                    title="Close plugin state panel"
                >
                    <PanelRightClose className="h-4 w-4" />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {!sessionId ? (
                    <p className="text-sm text-muted-foreground">
                        Create or select a conversation to view plugin state.
                    </p>
                ) : states.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No plugin state has been emitted for this session.
                    </p>
                ) : expandedState ? (
                    <div className="flex min-h-full flex-col">
                        <div className="mb-3 flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                            <button
                                className="mt-0.5 rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                onClick={() =>
                                    setExpandedPluginInstanceId(null)
                                }
                                title="Collapse expanded plugin state"
                            >
                                <Minimize2 className="h-4 w-4" />
                            </button>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-foreground">
                                    {expandedState.pluginName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {formatStateSubtitle(expandedState)}
                                </p>
                            </div>
                            {expandedDetail ? (
                                <CopyButton text={expandedDetail.markdown} />
                            ) : null}
                            {expandedLoading ? (
                                <RefreshCw className="mt-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            ) : null}
                        </div>

                        <div className="min-w-0 flex-1 rounded-lg border border-border/50 bg-secondary/20 px-4 py-3">
                            {expandedError ? (
                                <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                                    {expandedError}
                                </p>
                            ) : expandedDetail ? (
                                <MarkdownContent>
                                    {expandedDetail.markdown}
                                </MarkdownContent>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    Loading state...
                                </p>
                            )}
                        </div>

                        {states.length > 1 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/30 pt-3">
                                {states.map((state) => (
                                    <button
                                        key={state.pluginInstanceId}
                                        className={`rounded-md px-2 py-1 text-xs transition-colors ${
                                            state.pluginInstanceId ===
                                            expandedState.pluginInstanceId
                                            ? "bg-cyan-500/20 text-foreground"
                                                : "bg-secondary/60 text-muted-foreground hover:bg-accent hover:text-foreground"
                                        }`}
                                        onClick={() =>
                                            setExpandedPluginInstanceId(
                                                state.pluginInstanceId,
                                            )
                                        }
                                    >
                                        {formatStateLabel(state)}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {states.map((state) => {
                            const detail =
                                detailsByInstance[state.pluginInstanceId];
                            const error =
                                errorsByInstance[state.pluginInstanceId];
                            const isLoading =
                                loadingByInstance[state.pluginInstanceId];

                            return (
                                <section
                                    key={state.pluginInstanceId}
                                    className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
                                >
                                    <div className="mb-2 flex items-start gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium text-foreground">
                                                {state.pluginName}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground">
                                                {formatStateSubtitle(state)}
                                            </p>
                                        </div>
                                        {isLoading ? (
                                            <RefreshCw className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                        ) : null}
                                        <button
                                            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                            onClick={() =>
                                                setExpandedPluginInstanceId(
                                                    state.pluginInstanceId,
                                                )
                                            }
                                            title={`Expand ${state.pluginName} state`}
                                        >
                                            <Maximize2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>

                                    {error ? (
                                        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                                            {error}
                                        </p>
                                    ) : detail ? (
                                        <div className="max-h-60 overflow-hidden">
                                            <MarkdownContent>
                                                {detail.markdown}
                                            </MarkdownContent>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">
                                            Loading state...
                                        </p>
                                    )}
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>
        </aside>
    );
}
