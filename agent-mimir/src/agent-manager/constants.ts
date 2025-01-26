export const CONSTANTS = {
    MESSAGE_DIVIDER: "\n--------------------------------------------------\n\n",
    CONTENT_SPACING: "\n-----------------------------------------------\n\n",
    MAX_TOOL_RESPONSE_LENGTH: 400,
    DEFAULT_THREAD_ID: "1",
    DB_FILENAME: "agent-chat.db"
} as const;

export const ERROR_MESSAGES = {
    UNREACHABLE: "Unreachable",
    UNSUPPORTED_CONTENT_TYPE: (type: string) => `Unsupported content type: ${type}`,
} as const;
