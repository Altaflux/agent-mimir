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
};

export type SessionEvent =
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "user_message";
        text: string;
        workspaceFiles: string[];
        chatImages: string[];
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "tool_response";
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
        type: "agent_to_agent";
        messageId?: string;
        sourceAgent: string;
        destinationAgent: string;
        message: string;
        attachments: DownloadableFile[];
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "tool_request";
        payload: ToolRequestPayload;
        requiresApproval: boolean;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "agent_response_chunk";
        agentName: string;
        destinationAgent: string | undefined;
        messageId: string;
        markdownChunk: string;
    }
    | {
        id: string;
        sessionId: string;
        timestamp: string;
        type: "agent_response";
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

export type SetActiveAgentRequest = {
    agentName: string;
};

export type SetActiveAgentResponse = {
    session: SessionState;
};

export type ResetSessionResponse = {
    session: SessionState;
};

export type ApiErrorResponse = {
    error: {
        code: string;
        message: string;
    };
};
