export type DownloadableFile = {
    fileId: string;
    fileName: string;
    href?: string;
};

export type ToolCallPayload = {
    id?: string;
    toolName: string;
    input: string;
};

export type ToolRequestPayload = {
    messageId?: string;
    callingAgent: string;
    content: string;
    toolCalls: ToolCallPayload[];
};

export type SessionSummary = {
    sessionId: string;
    name: string;
    createdAt: string;
    lastActivityAt: string;
    activeAgentName: string;
    continuousMode: boolean;
    hasPendingToolRequest: boolean;
};

export type SessionState = SessionSummary & {
    agentNames: string[];
    pendingToolRequest?: ToolRequestPayload;
    pendingNotificationCount: number;
};

export type PluginRuntimeEventVisibility = "user" | "debug";

export type PluginRuntimeEventBody =
    | {
        type: "status";
        message: string;
        title?: string;
        level?: "info" | "warning" | "error";
    }
    | {
        type: "message";
        message: string;
        title?: string;
    }
    | {
        type: "progress";
        label?: string;
        message?: string;
        current?: number;
        total?: number;
    };

export type UserMessageOrigin =
    | {
        type: "user";
    }
    | {
        type: "plugin_notification";
        notificationId: string;
        pluginName: string;
        title: string;
        message?: string;
    };

export type SessionEvent =
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "user_message";
        taskId: string;
        origin: UserMessageOrigin;
        text: string;
        workspaceFiles: string[];
        chatImages: string[];
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "tool_response";
        taskId: string;
        messageId?: string;
        agentName: string;
        toolName: string;
        toolCallId?: string;
        response: string;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "tool_request";
        taskId: string;
        payload: ToolRequestPayload;
        requiresApproval: boolean;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "agent_response_chunk";
        taskId: string;
        agentName: string;
        messageId: string;
        markdownChunk: string;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "agent_response";
        taskId: string;
        agentName: string;
        messageId: string;
        markdown: string;
        attachments: DownloadableFile[];
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "state_changed";
        state: SessionState;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "plugin_event";
        taskId: string;
        toolCallId: string;
        toolName: string;
        pluginName: string;
        agentName: string;
        visibility: PluginRuntimeEventVisibility;
        body: PluginRuntimeEventBody;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "plugin_notification";
        notificationId: string;
        pluginName: string;
        agentName: string;
        title: string;
        message?: string;
        unreadCount: number;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "reset";
        message: string;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "error";
        message: string;
        code?: string;
    };

export type BootstrapResponse = {
    availableAgentNames: string[];
    defaultContinuousMode: boolean;
    defaultMainAgent: string | null;
};

export type ListSessionsResponse = {
    sessions: SessionSummary[];
};

export type CreateSessionRequest = {
    name?: string;
    agentName?: string;
};

export type CreateSessionResponse = {
    session: SessionState;
};

export type DeleteSessionResponse = {
    deleted: true;
};

export type SendMessageResponse = {
    session: SessionState;
};

export type ProcessNotificationsResponse = {
    session: SessionState;
};

export type ApprovalRequest = {
    action: "approve" | "disapprove";
    feedback?: string;
};

export type ApprovalResponse = {
    session: SessionState;
};

export type ToggleContinuousModeRequest = {
    enabled: boolean;
};

export type ToggleContinuousModeResponse = {
    session: SessionState;
};

export type ResetSessionResponse = {
    session: SessionState;
};

export type StopSessionResponse = {
    session: SessionState;
};

export type ApiErrorResponse = {
    error: {
        code: string;
        message: string;
    };
};
