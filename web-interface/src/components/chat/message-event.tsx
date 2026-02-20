"use client";

import { SessionEvent } from "@/lib/contracts";
import { formatTime } from "@/lib/api";
import { Bot, User, Wrench, Zap } from "lucide-react";
import { MarkdownContent } from "@/components/chat/markdown";
import { CollapsibleSection, DownloadLinks, ScrollableCodeBlock } from "@/components/chat/shared";

/** Renders a single session event as the appropriate message bubble / section. */
export function MessageEvent({ event }: { event: SessionEvent }) {
    if (event.type === "state_changed") return null;

    /* ── User message ─────────────── */
    if (event.type === "user_message") {
        return (
            <div className="flex justify-end animate-msg-in">
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
            <div className="flex items-start gap-3 animate-msg-in">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">{event.agentName}</span>
                        <span className="text-[10px] text-muted-foreground/60">{formatTime(event.timestamp)}</span>
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
            <div className="mx-auto max-w-[85%]">
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
            <div className="mx-auto max-w-[85%]">
                <CollapsibleSection
                    title={title}
                    icon={<Wrench className="h-3.5 w-3.5 text-amber-400" />}
                    defaultOpen={event.requiresApproval}
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
        );
    }

    /* ── Agent-to-Agent ───────────── */
    if (event.type === "agent_to_agent") {
        return (
            <div className="mx-auto max-w-[85%]">
                <CollapsibleSection
                    title={`${event.sourceAgent} → ${event.destinationAgent}`}
                    icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
                    defaultOpen
                >
                    <MarkdownContent>{event.message}</MarkdownContent>
                    <DownloadLinks files={event.attachments} />
                </CollapsibleSection>
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
