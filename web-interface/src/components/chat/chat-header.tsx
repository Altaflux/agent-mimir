"use client";

import { SessionState } from "@/lib/contracts";
import { Switch } from "@/components/ui/switch";
import { Menu, RefreshCw, Zap } from "lucide-react";

export interface ChatHeaderProps {
    sessionLabel: string;
    activeState: SessionState | undefined;
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
    onSetContinuousMode: (enabled: boolean) => void;
    onSetActiveAgent: (agentName: string) => void;
    onResetSession: () => void;
}

export function ChatHeader({
    sessionLabel,
    activeState,
    sidebarOpen,
    onToggleSidebar,
    onSetContinuousMode,
    onSetActiveAgent,
    onResetSession
}: ChatHeaderProps) {
    return (
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 bg-background/80 backdrop-blur-sm shrink-0">
            <button
                className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={onToggleSidebar}
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
                            onCheckedChange={(checked) => onSetContinuousMode(Boolean(checked))}
                        />
                    </label>

                    <select
                        className="h-8 rounded-lg border border-border bg-secondary px-2 text-xs text-foreground appearance-none cursor-pointer"
                        value={activeState.activeAgentName}
                        onChange={(event) => onSetActiveAgent(event.target.value)}
                    >
                        {activeState.agentNames.map((agentName) => (
                            <option key={agentName} value={agentName}>
                                {agentName}
                            </option>
                        ))}
                    </select>

                    <button
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        onClick={onResetSession}
                        title="Reset session"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </button>
                </div>
            ) : null}
        </header>
    );
}
