# Implementation Plan: Agent Factory Pattern for OrchestratorBuilder

This document outlines the implementation plan for modifying the OrchestratorBuilder to support multiple agent types using a factory pattern.

## Overview

The current implementation of the OrchestratorBuilder only supports one type of agent (code agent). We will modify it to support multiple agent types by implementing a factory pattern. This will allow the OrchestratorBuilder to create different types of agents based on the factory provided.

## Implementation Steps

### 1. Create AgentConfig and AgentFactory Interface

Create a new file `agent-mimir/src/agent-manager/factory.ts`:

```typescript
import { Agent } from "./index.js";
import { PluginFactory } from "../plugins/index.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { WorkspaceFactory } from "./index.js";

/**
 * Configuration for creating an agent.
 * Contains all necessary parameters except plugins, which are provided separately.
 */
export interface AgentConfig {
    /** The professional role or expertise of the agent */
    profession: string;
    /** A description of the agent's purpose and capabilities */
    description: string;
    /** The unique name identifier for the agent */
    name: string;
    /** The language model to be used by the agent */
    model: BaseChatModel;
    /** Optional constitution defining agent behavior guidelines */
    constitution?: string;
    /** Optional vision support type (currently only supports 'openai') */
    visionSupport?: 'openai';
    /** Factory function to create the agent's workspace */
    workspaceFactory: WorkspaceFactory;
}

/**
 * Interface for agent factories that create different types of agents.
 * Provides a common interface for creating agents regardless of their implementation.
 */
export interface AgentFactory {
    /**
     * Creates an agent with the specified plugins.
     * @param plugins Array of plugin factories to extend agent functionality
     * @returns A Promise that resolves to the created agent
     */
    create(plugins: PluginFactory[]): Promise<Agent>;
}
```

### 2. Implement Concrete Factories

#### Code Agent Factory

Create `agent-mimir/src/agent-manager/code-agent/factory.ts`:

```typescript
import { Agent } from "../index.js";
import { AgentFactory, AgentConfig } from "../factory.js";
import { createAgent as createCodeAgent } from "./agent.js";
import { PluginFactory } from "../../plugins/index.js";

/**
 * Factory for creating code agents.
 * Implements the AgentFactory interface for code agents.
 */
export class CodeAgentFactory implements AgentFactory {
    private config: AgentConfig;
    
    /**
     * Creates a new CodeAgentFactory with the specified configuration.
     * @param config Configuration for the code agent
     */
    constructor(config: AgentConfig) {
        this.config = config;
    }
    
    /**
     * Creates a code agent with the specified plugins.
     * @param plugins Array of plugin factories to extend agent functionality
     * @returns A Promise that resolves to the created code agent
     */
    async create(plugins: PluginFactory[]): Promise<Agent> {
        return createCodeAgent({
            ...this.config,
            plugins: plugins
        });
    }
}
```

#### Function Agent Factory

Create `agent-mimir/src/agent-manager/function-agent/factory.ts`:

```typescript
import { Agent } from "../index.js";
import { AgentFactory, AgentConfig } from "../factory.js";
import { createAgent as createFunctionAgent } from "./agent.js";
import { PluginFactory } from "../../plugins/index.js";

/**
 * Factory for creating function agents.
 * Implements the AgentFactory interface for function agents.
 */
export class FunctionAgentFactory implements AgentFactory {
    private config: AgentConfig;
    
    /**
     * Creates a new FunctionAgentFactory with the specified configuration.
     * @param config Configuration for the function agent
     */
    constructor(config: AgentConfig) {
        this.config = config;
    }
    
    /**
     * Creates a function agent with the specified plugins.
     * @param plugins Array of plugin factories to extend agent functionality
     * @returns A Promise that resolves to the created function agent
     */
    async create(plugins: PluginFactory[]): Promise<Agent> {
        return createFunctionAgent({
            ...this.config,
            plugins: plugins
        });
    }
}
```

### 3. Modify OrchestratorBuilder

Update `agent-mimir/src/communication/multi-agent.ts`:

```typescript
import { Agent, AgentResponse, AgentMessageToolRequest, AgentUserMessageResponse, ToolResponseInfo, InputAgentMessage } from "../agent-manager/index.js";
import { AgentFactory } from "../agent-manager/factory.js";
import { HelpersPluginFactory } from "../agent-manager/function-agent/helpers.js";
import { PluginFactory } from "../plugins/index.js";

// ... existing types ...

export class OrchestratorBuilder {
    private readonly agentManager: Map<string, Agent> = new Map();

    constructor() {
    }

    /**
     * Initializes an agent using the provided factory and adds it to the orchestrator.
     * @param factory The factory to use for creating the agent
     * @param name The name of the agent
     * @param communicationWhitelist Optional whitelist of agent names this agent can communicate with
     * @param additionalPlugins Optional additional plugins to add to the agent
     * @returns The created agent
     */
    async initializeAgent(
        factory: AgentFactory, 
        name: string, 
        communicationWhitelist?: string[] | boolean,
        additionalPlugins?: PluginFactory[]
    ): Promise<Agent> {
        let whitelist = undefined;
        if (Array.isArray(communicationWhitelist)) {
            whitelist = communicationWhitelist;
        }
        
        const helpersPlugin = new HelpersPluginFactory({
            name: name,
            helperSingleton: this.agentManager,
            communicationWhitelist: whitelist ?? null,
            destinationAgentFieldName: DESTINATION_AGENT_ATTRIBUTE
        });
        
        const plugins: PluginFactory[] = [helpersPlugin];
        if (additionalPlugins) {
            plugins.push(...additionalPlugins);
        }

        const agent = await factory.create(plugins);
        this.agentManager.set(name, agent);
        return agent;
    }

    build(currentAgent: Agent) {
        return new MultiAgentCommunicationOrchestrator(this.agentManager, currentAgent);
    }
}

// ... rest of the file remains unchanged ...
```

### 4. Export Factories

Update `agent-mimir/src/agent-manager/index.ts` to export the factory interface and AgentConfig:

```typescript
// Add this to the exports
export { AgentFactory, AgentConfig } from "./factory.js";
```

Update `agent-mimir/src/agent-manager/code-agent/index.ts` to export the code agent factory:

```typescript
export { CodeAgentFactory } from "./factory.js";
export { createAgent } from "./agent.js";
```

Update `agent-mimir/src/agent-manager/function-agent/index.ts` to export the function agent factory:

```typescript
export { FunctionAgentFactory } from "./factory.js";
export { createAgent } from "./agent.js";
```

## Usage Example

Here's how the updated OrchestratorBuilder would be used:

```typescript
import { CodeAgentFactory } from "../agent-manager/code-agent/index.js";
import { FunctionAgentFactory } from "../agent-manager/function-agent/index.js";
import { OrchestratorBuilder } from "../communication/multi-agent.js";

// Create the orchestrator
const orchestrator = new OrchestratorBuilder();

// Create a code agent
const codeAgentFactory = new CodeAgentFactory({
    name: "code-agent",
    description: "A code-writing agent",
    profession: "Programmer",
    model: model,
    workspaceFactory: workspaceFactory,
});
const codeAgent = await orchestrator.initializeAgent(
    codeAgentFactory, 
    "code-agent", 
    ["function-agent"]
);

// Create a function agent in the same orchestrator
const functionAgentFactory = new FunctionAgentFactory({
    name: "function-agent",
    description: "A function-calling agent",
    profession: "Assistant",
    model: model,
    workspaceFactory: workspaceFactory,
});
const functionAgent = await orchestrator.initializeAgent(
    functionAgentFactory, 
    "function-agent", 
    ["code-agent"]
);

// Build the orchestrator with the code agent as the current agent
const multiAgentOrchestrator = orchestrator.build(codeAgent);
```

## Benefits of This Approach

1. **Multiple Agent Types**: The OrchestratorBuilder can now manage multiple agent types simultaneously.
2. **Flexibility**: The agent factory is passed to the initializeAgent method, allowing different agent types to be created within the same orchestrator.
3. **Separation of Concerns**: The agent configuration is part of the factory, while plugins are managed separately.
4. **Extensibility**: New agent types can be added by implementing the AgentFactory interface.
5. **Type Safety**: Each agent type has its own factory implementation, providing type safety.