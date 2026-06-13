export const CONSTANTS = {
    MESSAGE_DIVIDER: "\n--------------------------------------------------\n\n",
} as const;

export const ERROR_MESSAGES = {
    UNREACHABLE: "Unreachable",
    UNSUPPORTED_CONTENT_TYPE: (type: string) => `Unsupported content type: ${type}`,
} as const;



export const DEFAULT_CONSTITUTION = `You are an expert assistant who can solve any task using code blobs. You will be given a task to solve as best you can.`