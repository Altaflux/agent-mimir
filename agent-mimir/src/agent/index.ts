import { MimirAgentArgs } from '../schema.js';


import { createOpenAiFunctionAgent } from '../agent/openai-function-agent.js';
import { createPlainTextMimirAgent } from '../agent/plain-text-agent.js';


export type MimirAgentTypes = "openai-function-agent" | "plain-text-agent";

export async function initializeAgent(agentType: MimirAgentTypes, options: MimirAgentArgs) {
    switch (agentType) {
        case "openai-function-agent": {
            return createOpenAiFunctionAgent(options);
        }
        case "plain-text-agent": {
            return createPlainTextMimirAgent(options);
        }
    }
}