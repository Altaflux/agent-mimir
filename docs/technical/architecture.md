# Architecture Overview

## Monorepo structure

The repository is a workspace monorepo managed by npm workspaces and Turbo.

Main packages in scope:

- `agent-mimir`: reusable core framework
- `agent-mimir-cli`: CLI runtime
- `agent-mimir-discord`: Discord runtime
- `lg-server`: LangGraph dev server runtime

Out of scope for this document set:

- root `tools/` directory packages

## High-level runtime topology

```text
User (CLI/Discord/LG request)
   -> Runtime app (agent-mimir-cli | agent-mimir-discord | lg-server)
      -> OrchestratorBuilder / MultiAgentCommunicationOrchestrator
         -> One or more LanggraphAgent instances
            -> StateGraph workflow (LLM node + review node + tool/code node)
               -> Plugins (context, tools, attributes, commands)
               -> Workspace (filesystem-backed by default)
               -> LLM provider via LangChain model interface
```

## Core domains in `agent-mimir`

### 1) Agent contract and state

`agent-mimir/src/agent-manager/index.ts` defines:

- `Agent` interface (`call`, `handleCommand`, `reset`)
- message models (`InputAgentMessage`, `AgentResponse`, tool request/response types)
- workspace contract (`AgentWorkspace`)

`agent-mimir/src/agent-manager/langgraph-agent.ts` provides the concrete `LanggraphAgent` wrapper around a compiled LangGraph graph.

### 2) Agent implementations

There are two main agent implementations:

- Tool agent (`agent-mimir/src/agent-manager/tool-agent/`)
  - Uses LangChain tool calling (`tool_calls`)
  - Executes tools in the graph tool node
- Code agent (`agent-mimir/src/agent-manager/code-agent/`)
  - Uses XML-tagged code output (`<execution-code>`, `<pip-dependencies-to-install>`)
  - Executes Python through a `CodeToolExecutor`

### 3) Multi-agent orchestration

`agent-mimir/src/communication/multi-agent.ts` manages:

- agent registry
- helper plugin injection per agent (for agent-to-agent messaging)
- routing between agents based on response attribute `destinationAgent`
- forwarding intermediate outputs and final responses

### 4) Plugin system

`agent-mimir/src/plugins/index.ts` defines extension points:

- lifecycle hooks (`init`, `readyToProceed`, `reset`)
- context injection (`getSystemMessages`, `additionalMessageContent`)
- tool surface (`tools`)
- response metadata extraction (`attributes`, `readResponse`)
- custom commands (`getCommands`)

`PluginContextProvider` merges plugin context into system and user-facing input streams and tracks retention metadata.

### 5) Workspace abstraction

The default Node.js implementation (`FileSystemAgentWorkspace`) is at:

- `agent-mimir/src/nodejs/filesystem-work-directory.ts`

Responsibilities:

- manage per-agent workspace directory
- list/read/copy/reset files
- expose file URLs (local file paths in this implementation)

### 6) Shared message/content model

`agent-mimir/src/schema.ts` defines `ComplexMessageContent`:

- text blocks
- image blocks

Utility conversion between internal model and LangChain message content is centralized in:

- `agent-mimir/src/utils/format.ts`
- `agent-mimir/src/agent-manager/message-utils.ts`

## Runtime applications

### CLI (`agent-mimir-cli`)

- boots config (`mimir-cfg.js` or default)
- creates agents with `CodeAgentFactory`
- runs interactive terminal loop in `src/chat.ts`

### Discord (`agent-mimir-discord`)

- same core orchestration model, wrapped in Discord events
- command + message handling + streaming intermediate output to channel

### LangGraph server (`lg-server`)

- creates a code agent graph and exports it for LangGraph CLI server
- includes example MCP server wiring

## Architectural invariants

These patterns are consistent across current implementations:

- Orchestration and execution are separated:
  - orchestration in `MultiAgentCommunicationOrchestrator`
  - execution in `LanggraphAgent` graphs
- Plugins are first-class extension points for:
  - tools
  - prompt context
  - response metadata
- Workspaces are isolated per agent instance
- Human approval is part of graph flow before tool/code execution
