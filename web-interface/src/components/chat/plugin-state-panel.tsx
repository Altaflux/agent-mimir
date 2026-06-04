"use client";

import { MarkdownContent } from "@/components/chat/markdown";
import { formatTime } from "@/lib/api";
import type { GetPluginStateResponse, PluginStateDetail, PluginStateSummary } from "@/lib/contracts";
import { PanelRightClose, Puzzle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type PluginStatePanelProps = {
    sessionId: string | null;
    states: PluginStateSummary[];
    open: boolean;
    onClose: () => void;
};

export function PluginStatePanel({ sessionId, states, open, onClose }: PluginStatePanelProps) {
    const [detailsByPlugin, setDetailsByPlugin] = useState<Record<string, PluginStateDetail>>({});
    const [loadingByPlugin, setLoadingByPlugin] = useState<Record<string, boolean>>({});
    const [errorsByPlugin, setErrorsByPlugin] = useState<Record<string, string>>({});

    const stateKey = useMemo(
        () => states.map((state) => `${state.pluginName}:${state.revision}`).join("|"),
        [states]
    );

    useEffect(() => {
        setDetailsByPlugin({});
        setLoadingByPlugin({});
        setErrorsByPlugin({});
    }, [sessionId]);

    useEffect(() => {
        if (!open || !sessionId) {
            return;
        }

        const pluginNames = new Set(states.map((state) => state.pluginName));
        setDetailsByPlugin((current) => {
            const next: Record<string, PluginStateDetail> = {};
            for (const [pluginName, detail] of Object.entries(current)) {
                if (pluginNames.has(pluginName)) {
                    next[pluginName] = detail;
                }
            }
            return next;
        });

        let cancelled = false;
        for (const state of states) {
            setLoadingByPlugin((current) => ({ ...current, [state.pluginName]: true }));
            fetch(`/api/sessions/${sessionId}/plugin-states/${encodeURIComponent(state.pluginName)}`, {
                method: "GET",
                cache: "no-store",
                headers: { "Cache-Control": "no-cache" }
            })
                .then(async (response) => {
                    const payload = (await response.json()) as GetPluginStateResponse | { error?: { message?: string } };
                    if (!response.ok) {
                        throw new Error(payload.error?.message ?? "Unable to load plugin state.");
                    }
                    return (payload as GetPluginStateResponse).state;
                })
                .then((detail) => {
                    if (cancelled) return;
                    setDetailsByPlugin((current) => ({ ...current, [detail.pluginName]: detail }));
                    setErrorsByPlugin((current) => {
                        const { [detail.pluginName]: _removed, ...rest } = current;
                        return rest;
                    });
                })
                .catch((error) => {
                    if (cancelled) return;
                    setErrorsByPlugin((current) => ({
                        ...current,
                        [state.pluginName]: error instanceof Error ? error.message : "Unable to load plugin state."
                    }));
                })
                .finally(() => {
                    if (cancelled) return;
                    setLoadingByPlugin((current) => ({ ...current, [state.pluginName]: false }));
                });
        }

        return () => {
            cancelled = true;
        };
    }, [open, sessionId, stateKey, states]);

    if (!open) {
        return null;
    }

    return (
        <aside className="absolute right-0 top-0 z-30 flex h-full w-[min(24rem,calc(100vw-2rem))] flex-col border-l border-border/40 bg-background shadow-2xl md:relative md:z-auto md:w-80 md:shadow-none">
            <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2.5">
                <Puzzle className="h-4 w-4 text-cyan-500" />
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-foreground">Plugin state</h2>
                    <p className="text-xs text-muted-foreground">
                        {states.length === 1 ? "1 active plugin" : `${states.length} active plugins`}
                    </p>
                </div>
                <button
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={onClose}
                    title="Close plugin state panel"
                >
                    <PanelRightClose className="h-4 w-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
                {!sessionId ? (
                    <p className="text-sm text-muted-foreground">Create or select a conversation to view plugin state.</p>
                ) : states.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No plugin state has been emitted for this session.</p>
                ) : (
                    <div className="space-y-3">
                        {states.map((state) => {
                            const detail = detailsByPlugin[state.pluginName];
                            const error = errorsByPlugin[state.pluginName];
                            const isLoading = loadingByPlugin[state.pluginName];

                            return (
                                <section
                                    key={state.pluginName}
                                    className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
                                >
                                    <div className="mb-2 flex items-start gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium text-foreground">{state.pluginName}</p>
                                            <p className="text-[11px] text-muted-foreground">
                                                {state.agentName} · {formatTime(state.updatedAt)}
                                            </p>
                                        </div>
                                        {isLoading ? <RefreshCw className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
                                    </div>

                                    {error ? (
                                        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                                            {error}
                                        </p>
                                    ) : detail ? (
                                        <MarkdownContent>{detail.markdown}</MarkdownContent>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">Loading state...</p>
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
