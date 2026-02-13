# Agent Runtime and Control Flow

## End-to-end invocation flow

For both CLI and Discord paths, the effective call path is:

```text
Input message/command
 -> MultiAgentCommunicationOrchestrator.handleMessage|handleCommand
 -> Current agent (LanggraphAgent)
 -> StateGraph stream loop
 -> Intermediate events yielded
 -> Final result (tool request or user response)
```

## `LanggraphAgent` responsibilities

Implemented in `agent-mimir/src/agent-manager/langgraph-agent.ts`.

Key behavior:

- reads graph state by `thread_id`
- resumes pending human interrupts when needed
- streams graph outputs (`messages`, `values`)
- emits intermediate tool responses
- returns final:
  - `toolRequest` (if paused at human review)
  - `agentResponse` (normal completion)
- tracks checkpoint id from graph state

Reset behavior:

- calls `plugin.reset()` for all plugins
- calls `workspace.reset()`
- removes all stored messages in graph state for the thread

## Multi-agent routing model

Implemented in `agent-mimir/src/communication/multi-agent.ts`.

Routing mechanism:

- every created agent gets a helper plugin
- helper plugin exposes an attribute to set destination agent name
- if response attribute `destinationAgent` is present:
  - orchestrator pushes current agent to stack
  - forwards message to destination agent
- if no destination:
  - response goes back to previous agent (stack pop) or user

Intermediate event types exposed by orchestrator:

- `intermediateOutput` (tool responses, chunks)
- `agentToAgentMessage` (routed message event)

## Code agent graph flow

Implemented in `agent-mimir/src/agent-manager/code-agent/agent.ts`.

Graph nodes:

- `message_prep`: retention policy cleanup
- `call_llm`: builds prompt + plugin context + XML response format constraints
- `human_review_node`: human accept/edit/feedback gate
- `run_tool`: Python code execution node (via `pythonToolNodeFunction`)

Conditional edges:

- if model output has `CODE_EXECUTION` tool call -> `human_review_node`
- else -> graph `END`

Special behavior:

- if no content from model, injects "I have completed my task."
- strips visible output in agent-to-agent contexts to avoid false completion assumptions

## Tool agent graph flow

Implemented in `agent-mimir/src/agent-manager/tool-agent/agent.ts`.

Graph nodes:

- same high-level pattern as code agent:
  - `message_prep`
  - `call_llm`
  - `human_review_node`
  - `run_tool`

Execution detail:

- model is `bindTools(...)` with wrapped Mimir tools
- `run_tool` executes LangChain tool calls
- tool execution errors can be transformed into tool messages when configured

## Prompt context composition

For both agent types:

- constitution (`DEFAULT_CONSTITUTION` unless overridden)
- response metadata formatting instructions (XML schema-like contract)
- plugin system context block from `PluginContextProvider`
- per-message plugin enrichment (`additionalMessageContent`)

Response metadata extraction:

- `ResponseFieldMapper` parses `<response-metadata><attributes>...`
- user-visible text is extracted from content after marker `MESSAGE TO SEND:`

## Retention policy behavior

`PluginContextProvider` supports persistence control per injected content piece:

- `saveToChatHistory: true` -> persistent
- `saveToChatHistory: number` -> retained for limited number of future turns
- `displayOnCurrentMessage` controls whether it is shown immediately in the active turn

Retention cleanup runs in `message_prep` by filtering stored content against policy age.
