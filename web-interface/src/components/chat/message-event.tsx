"use client";

import { type SessionEvent } from "@/lib/contracts";
import { formatTime } from "@/lib/api";
import { Bell, Bot, Radio, User, Wrench } from "lucide-react";
import { MarkdownContent } from "@/components/chat/markdown";
import { CollapsibleSection, DownloadLinks, ScrollableCodeBlock, CopyButton } from "@/components/chat/shared";

/** Renders a single session event as the appropriate message bubble / section. */
export function MessageEvent({ event }: { event: SessionEvent }) {
    if (event.type === "state_changed") return null;

    /* ── User message ─────────────── */
    if (event.type === "user_message") {
        return (
            <div className="flex justify-end animate-msg-in">
                <div className="max-w-[80%] flex items-start gap-2.5">
                    <div className="group rounded-2xl rounded-tr-sm bg-user-bubble px-4 py-2.5">
                        <div className="flex items-start justify-between gap-4">
                            <p className="whitespace-pre-wrap text-sm text-foreground">{event.text || "(No text)"}</p>
                            {event.text ? <div className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"><CopyButton text={event.text} /></div> : null}
                        </div>
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
            <div className="flex items-start gap-3 animate-msg-in">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1 group">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">{event.agentName}</span>
                        <span className="text-[10px] text-muted-foreground/60">{formatTime(event.timestamp)}</span>
                        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                            <CopyButton text={event.markdown} />
                        </div>
                    </div>
                    <MarkdownContent>{event.markdown}</MarkdownContent>
                    <DownloadLinks files={event.attachments} />
                </div>
            </div>
        );
    }

    /* ── Agent response chunk (streaming) ── */
    if (event.type === "agent_response_chunk") {
        return (
            <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">{event.agentName}</span>
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse-glow" title="Streaming..." />
                    </div>
                    <MarkdownContent>{event.markdownChunk}</MarkdownContent>
                </div>
            </div>
        );
    }

    /* ── Tool response ────────────── */
    if (event.type === "tool_response") {
        return (
            <div className="flex items-start gap-3 animate-msg-in">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Wrench className="h-4 w-4 text-cyan-500" />
                </div>
                <div className="min-w-0 flex-1">
                    <CollapsibleSection
                        title={`Tool Response: ${event.toolName} [${event.agentName}]`}
                        icon={<Wrench className="h-3.5 w-3.5 text-cyan-400" />}
                        className="border-cyan-500/20 bg-cyan-500/5"
                    >
                        <ScrollableCodeBlock text={event.response} />
                    </CollapsibleSection>
                </div>
            </div>
        );
    }

    /* ── Tool request ─────────────── */
    if (event.type === "tool_request") {
        const title = event.requiresApproval
            ? `Tool Approval: ${event.payload.callingAgent}`
            : `Tool Call (auto): ${event.payload.callingAgent}`;
        return (
            <div className="flex items-start gap-3 animate-msg-in">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Wrench className={`h-4 w-4 ${event.requiresApproval ? "text-amber-500" : "text-muted-foreground"}`} />
                </div>
                <div className="min-w-0 flex-1">
                    <CollapsibleSection
                        title={title}
                        icon={<Wrench className={event.requiresApproval ? "h-3.5 w-3.5 text-amber-400" : "h-3.5 w-3.5 text-muted-foreground"} />}
                        defaultOpen={true}
                        className={event.requiresApproval ? "border-amber-500/40 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.05)]" : "border-border/50 bg-secondary/30"}
                    >
                        <div className="space-y-2">
                            {event.payload.toolCalls.map((call, index) => {
                                if (call.toolName === "CODE_EXECUTION") {
                                    try {
                                        const parsed = JSON.parse(call.input);
                                        if (typeof parsed === "object" && parsed !== null && typeof parsed.script === "string") {
                                            const libraries = Array.isArray(parsed.libraries) && parsed.libraries.length > 0 ? parsed.libraries : null;
                                            return (
                                                <div key={`${event.id}-${index}`} className="border-t border-border/30 pt-2">
                                                    <p className="text-xs font-semibold text-foreground mb-1">{call.toolName}</p>
                                                    {libraries && (
                                                        <p className="text-[11px] text-muted-foreground mb-2">
                                                            Libraries to install: <span className="font-mono text-emerald-400 bg-secondary/50 px-1 py-0.5 rounded">{libraries.join(", ")}</span>
                                                        </p>
                                                    )}
                                                    <MarkdownContent>
                                                        {`\`\`\`python\n${parsed.script}\n\`\`\``}
                                                    </MarkdownContent>
                                                </div>
                                            );
                                        }
                                    } catch {
                                        // Silently fallback to default raw render if JSON is invalid
                                    }
                                }

                                return (
                                    <div key={`${event.id}-${index}`} className="border-t border-border/30 pt-2">
                                        <p className="text-xs font-semibold text-foreground mb-1">{call.toolName}</p>
                                        <ScrollableCodeBlock text={call.input} />
                                    </div>
                                );
                            })}
                        </div>
                    </CollapsibleSection>
                </div>
            </div>
        );
    }

    /* ── Plugin runtime event ─────── */
    if (event.type === "plugin_event") {
        const body = event.body;
        const title = body.type === "progress"
            ? body.label ?? "Plugin progress"
            : body.title ?? (body.type === "status" ? "Plugin status" : "Plugin message");
        const detail = body.type === "progress"
            ? [
                body.message,
                body.current !== undefined && body.total !== undefined ? `${body.current}/${body.total}` : undefined
            ].filter(Boolean).join(" ")
            : body.message;

        return (
            <div className="flex items-start gap-3 animate-msg-in">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Radio className="h-4 w-4 text-cyan-500" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">{event.pluginName}</span>
                            <span className="text-[10px] text-muted-foreground/60">{formatTime(event.timestamp)}</span>
                            {event.scope?.taskId ? (
                                <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {event.scope.taskId}
                                </span>
                            ) : null}
                        </div>
                        <p className="mt-1 text-sm font-medium text-foreground">{title}</p>
                        {detail ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{detail}</p> : null}
                    </div>
                </div>
            </div>
        );
    }

    /* ── Plugin notification ──────── */
    if (event.type === "plugin_notification") {
        return (
            <div className="flex items-start gap-3 animate-msg-in">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Bell className="h-4 w-4 text-cyan-500" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">{event.pluginName}</span>
                            <span className="text-[10px] text-muted-foreground/60">{formatTime(event.timestamp)}</span>
                            <span className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {event.unreadCount} unread
                            </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-foreground">{event.title}</p>
                        {event.message ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{event.message}</p> : null}
                    </div>
                </div>
            </div>
        );
    }

    /* ── Reset ─────────────────────── */
    if (event.type === "reset") {
        return (
            <div className="flex justify-center animate-msg-in">
                <div className="rounded-full bg-secondary/50 px-4 py-1.5 text-xs text-muted-foreground">
                    🔄 {event.message}
                </div>
            </div>
        );
    }

    /* ── Error ─────────────────────── */
    return (
        <div className="mx-auto max-w-[85%] animate-msg-in">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <p className="text-xs font-semibold text-red-400 mb-1">{event.code ?? "Error"}</p>
                <p className="text-sm text-foreground/90">{event.message}</p>
            </div>
        </div>
    );
}
