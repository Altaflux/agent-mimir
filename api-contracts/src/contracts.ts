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
  agentName: string;
  continuousMode: boolean;
  hasPendingToolRequest: boolean;
};

export type SessionState = SessionSummary & {
  pendingToolRequest?: ToolRequestPayload;
  pendingNotificationCount: number;
};

export type PluginStateSummary = {
  pluginInstanceId: string;
  pluginId: string;
  pluginPrefix?: string;
  pluginNamespace: string;
  agentName: string;
  updatedAt: string;
  revision: string;
};

export type PluginStateDetail = PluginStateSummary & {
  markdown: string;
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
      pluginId: string;
      pluginPrefix?: string;
      pluginNamespace: string;
      title: string;
      summary?: string;
    };

export type SessionEvent =
  | {
      id: string;
      sessionId: string;
      timestamp: string;
      type: "user_message";
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
      payload: ToolRequestPayload;
      requiresApproval: boolean;
    }
  | {
      id: string;
      sessionId: string;
      timestamp: string;
      type: "agent_response_chunk";
      agentName: string;
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
      type: "plugin_event";
      toolCallId: string;
      toolName: string;
      pluginInstanceId: string;
      pluginId: string;
      pluginPrefix?: string;
      pluginNamespace: string;
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
      pluginInstanceId: string;
      pluginId: string;
      pluginPrefix?: string;
      pluginNamespace: string;
      agentName: string;
      title: string;
      summary?: string;
      deduplicationId?: string;
      unreadCount: number;
    }
  | {
      id: string;
      sessionId: string;
      timestamp: string;
      type: "plugin_state";
      pluginInstanceId: string;
      pluginId: string;
      pluginPrefix?: string;
      pluginNamespace: string;
      agentName: string;
      updatedAt: string;
      revision: string;
    }
  | {
      id: string;
      sessionId: string;
      timestamp: string;
      type: "plugin_log";
      pluginInstanceId: string;
      pluginId: string;
      pluginPrefix?: string;
      pluginNamespace: string;
      agentName: string;
      text: string;
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
  defaultAgentName: string | null;
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

export type ListPluginStatesResponse = {
  states: PluginStateSummary[];
};

export type GetPluginStateResponse = {
  state: PluginStateDetail;
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
