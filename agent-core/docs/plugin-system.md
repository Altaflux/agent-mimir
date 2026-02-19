# Agent Mimir Plugin System

The Agent Mimir plugin system allows you to extend the capabilities of an agent by adding new tools, attributes, commands, and hooks into the agent's lifecycle.

## Overview

A plugin in Agent Mimir is composed of two main parts:
1.  **Plugin Factory**: A class that implements `PluginFactory` and is responsible for creating instances of your plugin.
2.  **Plugin Implementation**: A class that extends `AgentPlugin` and implements the actual logic.

## Plugin Structure

### 1. The Plugin Factory

The factory is responsible for instantiating your plugin. It receives a `PluginContext` which gives access to the agent's workspace.

```typescript
import { PluginFactory, PluginContext, AgentPlugin } from "agent-mimir/plugins";

export class MyPluginFactory implements PluginFactory {
    name: string = "my-plugin";

    async create(context: PluginContext): Promise<AgentPlugin> {
        return new MyPlugin(context);
    }
}
```

### 2. The Agent Plugin

The `AgentPlugin` abstract class provides several hooks that you can override to interact with the agent.

```typescript
import { AgentPlugin, NextMessage, AdditionalContent, AgentSystemMessage, AttributeDescriptor, AiResponseMessage, AgentCommand, AgentTool } from "agent-mimir/plugins";

class MyPlugin extends AgentPlugin {
    
    // Called when the plugin is initialized
    async init(): Promise<void> {
        // Initialization logic
    }

    // Add system messages to the agent's context
    async getSystemMessages(): Promise<AgentSystemMessage> {
        return {
            content: [
                { type: "text", text: "This is a system message from MyPlugin." }
            ]
        };
    }

    // Provide tools to the agent
    async tools(): Promise<AgentTool[]> {
        return [
            // List of tools
        ];
    }

    // Define attributes that the agent should populate in its response
    async attributes(nextMessage: NextMessage): Promise<AttributeDescriptor[]> {
        return [
            {
                name: "myAttribute",
                attributeType: "string",
                description: "Description of what the agent should put here",
                variableName: "myVar",
                required: false
            }
        ];
    }

    // Add additional content to user messages
    async additionalMessageContent(message: InputAgentMessage): Promise<AdditionalContent[]> {
        return [];
    }
    
    // Handle specific slash commands
    async getCommands(): Promise<AgentCommand[]> {
        return [];
    }
}
```

## Lifecycle Hooks & Capabilities

-   **`init()`**: perform setup tasks, like creating directories.
-   **`getSystemMessages()`**: Inject persistent context or instructions into the system prompt.
-   **`tools()`**: Return an array of `AgentTool` instances that the LLM can use.
-   **`attributes()`**: Define structured fields the LLM should fill out in its response (useful for extracting specific information).
-   **`readResponse()`**: Read the LLM's response and the populated attributes.
-   **`additionalMessageContent()`**: Dynamically append information to user messages before they are collecting by the LLM.
-   **`readyToProceed()`**: Hook called when the agent is about to process the next message.

## How to Create a Plugin

1.  **Define your Plugin Class**: Create a class extending `AgentPlugin`.
2.  **Implement Desired Methods**: Override methods like `tools()`, `getSystemMessages()`, etc.
3.  **Create a Factory**: Create a factory class implementing `PluginFactory` to instantiate your plugin.
4.  **Register the Plugin**: Pass your factory instance to the agent configuration.

### Example: A Simple Time Plugin

```typescript
import { AgentPlugin, PluginFactory, PluginContext, AgentSystemMessage } from "agent-mimir/plugins";

class TimePlugin extends AgentPlugin {
    async getSystemMessages(): Promise<AgentSystemMessage> {
        return {
            content: [
                {
                    type: "text",
                    text: `The current time is: ${new Date().toISOString()}`
                }
            ]
        };
    }
}

export class TimePluginFactory implements PluginFactory {
    name: string = "time";
    async create(context: PluginContext): Promise<AgentPlugin> {
        return new TimePlugin();
    }
}
```

## Using a Plugin

To use a plugin, include its factory in the `plugins` array when creating an agent.

```typescript
import { MimirAgentFactory } from "agent-mimir"; // Hypothetical import based on usage
import { TimePluginFactory } from "./my-time-plugin";

const agentConfig = {
    // ... other config ...
    plugins: [
        new TimePluginFactory(),
        // other plugins...
    ]
};

// Create agent with config
```
