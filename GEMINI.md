# Agent Mimir Architecture Guide

This document presents a high-level overview of the Agent Mimir architecture, its component layout, main files, and typical development workflows. It is meant to serve as a guide for engineering agents and developers to quickly understand how the application handles multi-agent operations, the client interface boundaries, and data flows.

## 1. High-Level Concept

Agent Mimir is a highly flexible agent framework built on top of [LangChainJS](https://js.langchain.com/docs/) and [LangGraph](https://langchain-ai.github.io/langgraphjs/). It allows Large Language Models (LLMs) to use external tools, manage conversation context dynamically, and orchestrate complex, multi-step problem-solving inspired by Auto-GPT loops. The application features multiple client interfaces (Discord, CLI, Web) that communicate with the core agent brain securely.

---

## 2. Directory Structure & Monorepo Workspaces

The repository is a TypeScript monorepo, managed via NPM Workspaces and Turborepo (`turbo.json`).

### 2.1 Frontends and Interfaces
- **`web-interface/`**: A Next.js React frontend. The primary visual UI handling interactive sessions, rendering Markdown, viewing agent thoughts, collapsible messages, and streaming event sequences in real-time.
- **`api-server/`**: The backend server representing the interface for the web frontend. It listens for interactions seamlessly via REST/SSE endpoints and coordinates sessions with `agent-core`.
- **`discord-interface/`**: Implements a bot connection enabling Discord servers to host, mention, and converse with agents.
- **`cli-interface/`**: The simplest interface. It runs the agent directly in terminal stdio streams, managing inputs and file attachments.

### 2.2 Core Application Logistics
- **`agent-core/`**: **The central nervous system of the project.** It contains the abstract interfaces, LangGraph state-machines, factory patterns for agent architectures, chat history compression models, multi-agent orchestration code, and plugin base structures.
- **`api-contracts/`**: Simple workspace holding Shared types and Zod payloads representing messaging protocols bridging the `api-server` backends and `web-interface` frontends.
- **`runtime-shared/`**: Contains shared configuration schemas, runtime utilities, and code needed transparently by cross-boundary code.

### 2.3 Plugins & Capabilities
- **`tools/`**: A directory acting as a workspace for specific plugins you can inject into an agent. For example:
  - `@agent-mimir/code-interpreter`: Grants the agent a sandboxed or local Python execution pipeline.
  - `@agent-mimir/mcp-client`: Uses the Model Context Protocol to talk to complex remote servers (e.g., local SQL server or isolated integrations).
  - `@agent-mimir/selenium-browser`: A controlled browser instance the agent can use to extract data or traverse web apps.

### 2.4 User Configurations
- **`agent-config/`**: Where user-specific overrides like `.env` and `mimir-cfg.js` can be specified, pointing to new LLM models or instantiating different sets of plugins overriding default behavior.

---

## 3. The `agent-core` Internals

Inside `agent-core/src/agent-manager`, logic is segmented into precise factories handling discrete topologies for agents.

- **Agent Factories (`agent-manager/factory.ts`)**: Base contracts containing definitions of the `profession`, `constitution`, and model. This lets the backend initialize instances dynamically.
- **Code Agent (`code-agent/agent.ts`)**: An implementation explicitly tailored for interacting heavily with source code, code-interpreters, or complex structural logic requiring strict JSON format outputs or script injection.
- **Tool/Function Agent (`tool-agent/agent.ts`)**: Usually leveraging OpenAI Function Calling or standard Tool inputs. It focuses purely on invoking external APIs cleanly.
- **LangGraph Agent (`langgraph-agent.ts`)**: Represents the modern cyclic loop framework, compiling the agents into predictable workflow steps to gracefully handle recursive actions, tool executions, error fallbacks, and human-in-the-loop breakpoints.
- **Multi-Agent Orchestrator (`communication/multi-agent.ts`)**: The mechanism combining multiple agent factories. It serves as an umbrella determining how `function-agent`, `code-agent`, and user messages get dispatched and communicated internally.

---

## 4. Main Workflows & Where to Look

### A. Developing or Modifying the Web Interface
- **Context:** Looking to change how chats render, or how streaming tokens look.
- **Look Inside:** `web-interface/src/components/chat/`
  - `chat-app.tsx` handles large layout and logic connections.
  - `message-event.tsx` or similar components render an individual user or agent response.
  - `use-chat-session.ts` typically parses the Server-Sent Events (SSE) arriving from the backend matching them via stable message chunks (`messageId`).

### B. Altering the Communication Payloads / Events
- **Context:** Wanting to send a new type of metadata along with a stream response (e.g., token usage arrays, user avatars, debug timing).
- **Look Inside:** 
  1. Add the shape update inside `api-contracts/src/contracts.ts` and compile.
  2. Emit this shape down the stream pipeline originating from `api-server/src/server.ts`.
  3. Respond to the payload inside the Next.js `web-interface` component hooks matching the new types.

### C. Adjusting Agent Core Capabilities & Prompts
- **Context:** You want to modify how the agent generates thoughts, constructs system instructions, or what baseline restrictions exist.
- **Look Inside:** `agent-core/src/agent-manager/`
  - Open `code-agent/agent.ts` or `tool-agent/agent.ts` to locate string templates or LangChain `SystemMessagePromptTemplate`.
  - To adjust the cyclic behavior (what it does right after finishing a tool call), look into the nodes initialized inside `langgraph-agent.ts`.

### D. Creating a New Tool (Plugin)
- **Context:** The agent needs to interact with an entirely fresh API or system wrapper (e.g., a Jira client).
- **Look Inside:**
  1. Generate a new module within the `tools/jira-plugin` workspace.
  2. Implement an interface extending Langchain's `Tool` object or Agent Mimir `PluginFactory` (often defined in `agent-core/src/plugins/index.ts`).
  3. Ensure the plugin outputs valid descriptive Markdown or Strings so the LLM understands the result.
  4. Enable it within the user `mimir-cfg.js` config file.
