"use client";

import { type SessionState } from "@/lib/contracts";
import { Switch } from "@/components/ui/switch";
import { Menu, PanelRightOpen, RefreshCw, Zap } from "lucide-react";

export interface ChatHeaderProps {
    sessionLabel: string;
    activeState: SessionState | undefined;
    sidebarOpen: boolean;
    pluginStateCount: number;
    pluginStatePanelOpen: boolean;
    onToggleSidebar: () => void;
    onTogglePluginStatePanel: () => void;
    onSetContinuousMode: (enabled: boolean) => void;
    onResetSession: () => void;
}

export function ChatHeader({
    sessionLabel,
    activeState,
    sidebarOpen,
    pluginStateCount,
    pluginStatePanelOpen,
    onToggleSidebar,
    onTogglePluginStatePanel,
    onSetContinuousMode,
    onResetSession,
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
                <h1 className="text-sm font-semibold truncate">
                    {sessionLabel}
                </h1>
                {activeState ? (
                    <p className="text-xs text-muted-foreground truncate">
                        Agent: {activeState.agentName}
                    </p>
                ) : null}
            </div>

            {activeState ? (
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        className="relative rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        onClick={onTogglePluginStatePanel}
                        title={
                            pluginStatePanelOpen
                                ? "Close plugin state panel"
                                : "Open plugin state panel"
                        }
                    >
                        <PanelRightOpen className="h-4 w-4" />
                        {pluginStateCount > 0 ? (
                            <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-cyan-500 px-1 text-center text-[10px] font-medium leading-4 text-background">
                                {pluginStateCount}
                            </span>
                        ) : null}
                    </button>

                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <Zap className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Auto</span>
                        <Switch
                            checked={activeState.continuousMode}
                            onCheckedChange={(checked) =>
                                onSetContinuousMode(Boolean(checked))
                            }
                        />
                    </label>

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
