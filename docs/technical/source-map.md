# Source Map (Core + Apps)

This map is intended as a fast navigation index for maintainers.

## Core package: `agent-core`

### Contracts and shared types

- `agent-core/src/schema.ts`
  - canonical message content types (`text`, `image`)
- `agent-core/src/agent-manager/index.ts`
  - agent/workspace interfaces and response types
- `agent-core/src/agent-manager/factory.ts`
  - generic agent factory contracts

### Graph runtime wrapper

- `agent-core/src/agent-manager/langgraph-agent.ts`
  - adapter from compiled LangGraph to `Agent` interface
  - streaming, resume, reset, checkpoint handling

### Agent implementations

- `agent-core/src/agent-manager/tool-agent/agent.ts`
  - tool-calling agent graph
- `agent-core/src/agent-manager/code-agent/agent.ts`
  - python code-execution agent graph
- `agent-core/src/agent-manager/tool-agent/tool-node.ts`
  - generic tool execution node
- `agent-core/src/agent-manager/code-agent/tool-node.ts`
  - python executor node + websocket tool bridge

### Code executors

- `agent-core/src/agent-manager/code-agent/executors/local-executor.ts`
  - local python/venv execution
- `agent-core/src/agent-manager/code-agent/executors/docker-executor.ts`
  - docker-backed python execution
- `agent-core/src/agent-manager/code-agent/executors/python-code.ts`
  - generated python bootstrap script template

### Prompt and metadata parsing

- `agent-core/src/agent-manager/code-agent/prompt.ts`
  - code agent prompt contract and function docs
- `agent-core/src/utils/instruction-mapper.ts`
  - XML response metadata schema generation + parsing
- `agent-core/src/agent-manager/code-agent/utils.ts`
  - XML tag extraction and helper transforms

### Plugin framework

- `agent-core/src/plugins/index.ts`
  - plugin interfaces and lifecycle hooks
- `agent-core/src/plugins/context-provider.ts`
  - plugin context merge and retention-aware message policy
- `agent-core/src/plugins/workspace.ts`
  - workspace plugin and workspace attribute manager
- `agent-core/src/plugins/default-plugins.ts`
  - default "time" plugin behavior
- `agent-core/docs/plugin-system.md`
  - plugin authoring guide

### Orchestration

- `agent-core/src/communication/multi-agent.ts`
  - orchestrator builder and cross-agent routing
- `agent-core/src/communication/helpers.ts`
  - helper plugin exposing agent-to-agent destination metadata

### Workspace implementation

- `agent-core/src/nodejs/filesystem-work-directory.ts`
  - default filesystem workspace

### Format/conversion utilities

- `agent-core/src/utils/format.ts`
  - internal <-> LangChain content conversion
- `agent-core/src/agent-manager/message-utils.ts`
  - message conversions and system message merging

## CLI app: `cli-interface`

- `cli-interface/src/index.ts`
  - app boot, config loading, orchestrator setup
- `cli-interface/src/chat.ts`
  - terminal event loop, commands, intermediate output rendering
- `cli-interface/src/default-config.ts`
  - fallback runtime configuration

## Discord app: `discord-interface`

- `discord-interface/src/index.ts`
  - Discord client lifecycle, slash commands, message handling
- `discord-interface/src/default-config.ts`
  - fallback runtime configuration

## LangGraph server app: `lg-server`

- `lg-server/src/index.ts`
  - graph export for LangGraph CLI server
  - includes sample plugin composition and MCP transport wiring

## Root-level operations

- `package.json` (root)
  - workspace scripts (`start-cli`, `start-discord`, `start-lg`, `build`)
- `scripts/config-setup.js`
  - stages config/dependencies into `.temp_custom_deps`
- `agent-config.example/mimir-cfg.js`
  - reference configuration shape
