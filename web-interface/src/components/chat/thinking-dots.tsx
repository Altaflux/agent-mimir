"use client";

import { Bot } from "lucide-react";

/** Animated three-dot "thinking" indicator shown while agent is processing. */
export function ThinkingDots() {
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
