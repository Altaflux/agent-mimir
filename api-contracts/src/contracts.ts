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

export type ElicitationResponseAction = "accept" | "decline" | "cancel";

export type ElicitationStringFormat = "email" | "uri" | "date" | "date-time";

export type ElicitationStringOption = {
  const: string;
  title?: string;
};

export type ElicitationStringSchema = {
  type: "string";
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: ElicitationStringFormat;
  default?: string;
  enum?: string[];
  oneOf?: ElicitationStringOption[];
};

export type ElicitationNumberSchema = {
  type: "number" | "integer";
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: number;
};

export type ElicitationBooleanSchema = {
  type: "boolean";
  title?: string;
  description?: string;
  default?: boolean;
};

export type ElicitationStringArraySchema = {
  type: "array";
  title?: string;
  description?: string;
  minItems?: number;
  maxItems?: number;
  default?: string[];
  items:
    | {
        type: "string";
        enum: string[];
      }
    | {
        anyOf: ElicitationStringOption[];
      };
};

export type ElicitationPropertySchema =
  | ElicitationStringSchema
  | ElicitationNumberSchema
  | ElicitationBooleanSchema
  | ElicitationStringArraySchema;

export type ElicitationRequestedSchema = {
  type: "object";
  properties: Record<string, ElicitationPropertySchema>;
  required?: string[];
};

export type PluginElicitationCreateRequest =
  | {
      mode?: "form";
      message: string;
      requestedSchema: ElicitationRequestedSchema;
    }
  | {
      mode: "url";
      message: string;
      url: string;
      elicitationId: string;
    };

export type PluginElicitationPayload = {
  elicitationRequestId: string;
  pluginInstanceId: string;
  pluginId: string;
  pluginPrefix?: string;
  pluginNamespace: string;
  agentName: string;
  createdAt: string;
  request: PluginElicitationCreateRequest;
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
  pendingElicitations: PluginElicitationPayload[];
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
      type: "plugin_elicitation_request";
      payload: PluginElicitationPayload;
    }
  | {
      id: string;
      sessionId: string;
      timestamp: string;
      type: "plugin_elicitation_response";
      elicitationRequestId: string;
      pluginInstanceId: string;
      pluginId: string;
      pluginPrefix?: string;
      pluginNamespace: string;
      agentName: string;
      request: PluginElicitationCreateRequest;
      action: ElicitationResponseAction;
      content?: Record<string, unknown>;
    }
  | {
      id: string;
      sessionId: string;
      timestamp: string;
      type: "plugin_elicitation_complete";
      elicitationRequestId: string;
      pluginInstanceId: string;
      pluginId: string;
      pluginPrefix?: string;
      pluginNamespace: string;
      agentName: string;
      elicitationId: string;
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

export type PluginElicitationResponseRequest =
  | {
      action: "accept";
      content?: Record<string, unknown>;
    }
  | {
      action: "decline";
    }
  | {
      action: "cancel";
    };

export type PluginElicitationResponseResponse = {
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
