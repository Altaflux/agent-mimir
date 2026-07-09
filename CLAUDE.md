# CLAUDE.md - Agent Mimir Development Guide

## What is Agent Mimir?

Agent Mimir is a TypeScript monorepo implementing a flexible LLM agent framework built on LangChain and LangGraph. It supports multiple interfaces (CLI, Discord, Web) sharing a core agent engine with pluggable tools and multi-agent orchestration.

## Repository Structure

```
agent-core/          # Core agent engine: LangGraph state machines, factories, plugins
api-contracts/       # Shared Zod schemas and types between api-server and web-interface
api-server/          # Fastify backend serving REST/SSE endpoints
cli-interface/       # Terminal CLI interface
discord-interface/   # Discord bot interface
web-interface/       # React 19 + TanStack Router + Vite frontend (port 3000)
runtime-shared/      # Shared config schemas, session management, runtime utilities
tools/               # Plugin workspace (each subdirectory is a separate package)
  code-interpreter/  # Sandboxed Python execution
  mcp-client/        # Model Context Protocol integration
  selenium-browser/  # Browser automation via Selenium
  playwright-browser/ # Browser automation via Playwright
  serper-search/     # Web search via Serper API
  sqlite-tool/       # SQLite database interaction
  javascript-code-runner/ # JavaScript code execution
  desktop-control/   # Desktop automation
  gameboy-play/      # GameBoy emulator tool
agent-config.example/ # Example user configuration
scripts/             # Build and setup scripts
```

## Monorepo Setup

- **Package manager:** npm (v9.5.0) with npm workspaces
- **Build orchestration:** Turborepo (`turbo.json`)
- **Language:** TypeScript (strict mode, ES2022 target, ESM modules throughout)
- **All packages use ESM** (`"type": "module"` in package.json)

### Dependency graph

```
agent-core (core, no internal deps)
├── cli-interface
├── discord-interface
├── runtime-shared → depends on agent-core, api-contracts
├── api-server → depends on api-contracts, runtime-shared
├── web-interface → depends on api-contracts
└── tools/* → peer-depend on agent-core
```

## Common Commands

```bash
npm run build          # Build all packages (via Turbo)
npm run dev            # Start all packages in dev mode
npm run test           # Run tests (agent-core only, Jest + ts-jest)
npm run lint           # Lint all packages (ESLint)
npm run format         # Format with Prettier (ts, tsx, md files)

# Running interfaces
npm run start-cli      # Start CLI interface
npm run start-discord  # Start Discord bot
npm run start-api      # Start API server only
npm run start-web      # Start web interface + API server
npm run start-web-dev  # Start web + API in dev mode (hot reload)
```

### Start scripts workflow

The `start-*` scripts follow a pattern:
1. Load `.env` via `dotenv-cli`
2. Run `scripts/config-setup.js` to prepare user config
3. Install custom deps in `.temp_custom_deps/`
4. Set `MIMIR_CFG_PATH` and launch the target workspace

## Testing

- **Framework:** Jest with ts-jest (ESM preset)
- **Location:** Tests are colocated in `agent-core/src/`
- **Run:** `npm run test` (only agent-core has tests)
- **Config:** `agent-core/jest.config.js`

## Code Conventions

- **Module format:** ES Modules everywhere (`.js` extensions in imports)
- **Package naming:** `@mimir/*` for core packages, `@agent-mimir/*` for published tools
- **TypeScript:** Strict mode, declaration files generated, source maps enabled
- **Validation:** Zod schemas for API contracts and config validation
- **No CI/CD pipelines** in the repo - builds and releases are run locally

### Architecture Patterns

- **Factory pattern:** `AgentFactory` and `PluginFactory` interfaces for extensible agent/plugin creation
- **LangGraph state machines:** Cyclic agent loops in `agent-core/src/agent-manager/langgraph-agent.ts`
- **Agent types:** `code-agent/` (structured JSON output) and `tool-agent/` (function calling)
- **Multi-agent:** Orchestrator in `agent-core/src/communication/multi-agent.ts`
- **Streaming:** SSE-based streaming from api-server to web-interface

### Key Files

| File | Purpose |
|------|---------|
| `agent-core/src/agent-manager/langgraph-agent.ts` | Main LangGraph agent loop |
| `agent-core/src/agent-manager/factory.ts` | Agent factory contracts |
| `agent-core/src/plugins/index.ts` | Plugin factory base classes |
| `agent-core/src/communication/multi-agent.ts` | Multi-agent orchestration |
| `api-contracts/src/contracts.ts` | Shared API Zod schemas |
| `api-server/src/server.ts` | Fastify server setup |
| `runtime-shared/src/runtime/` | Session management, config loading |

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required: LLM API key |
| `DISCORD_TOKEN` | Discord bot token |
| `AGENT_OPENAI_MODEL` | LLM model (default: gpt-4) |
| `MIMIR_API_HOST` / `MIMIR_API_PORT` | API server bind (default: 0.0.0.0:8787) |
| `MIMIR_API_PREFIX` | API route prefix (default: /v1) |
| `MIMIR_PUBLIC_API_BASE_PATH` | Frontend API path (use /api with web proxy) |
| `MIMIR_API_SERVICE_TOKEN` | Service-to-service auth token |
| `MIMIR_API_BASE_URL` | Web proxy target (default: http://127.0.0.1:8787) |
| `WORK_DIRECTORY` | Persistent agent state directory |

## User Configuration

Agents are configured via `mimir-config/mimir-cfg.js` (user-provided, not committed). See `agent-config.example/` for templates. The config file defines agents, LLM models, and plugins. Custom dependencies are installed dynamically via a `package.json` in the config directory.

## Creating a New Tool/Plugin

1. Create a new directory under `tools/` with its own `package.json`
2. Implement `PluginFactory` from `@mimir/agent-core`
3. Ensure tool outputs descriptive text/Markdown for LLM consumption
4. Register the plugin in the user's `mimir-cfg.js` config

## Gitignore Notes

The following are excluded from version control:
- `node_modules/`, `dist/`, `dist-cjs/`, `.next/`, `.turbo/`
- `.env` files (except `.env.example`)
- `.temp_custom_deps/`, `agent-config/` (user-specific)
- `coverage/`, `.langgraph_api`, `.svelte-kit/`
