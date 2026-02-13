# Configuration and Operations

## Runtime entrypoints

Root `package.json` scripts orchestrate app startup:

- `npm run start-cli`
- `npm run start-discord`
- `npm run start-lg`

Each startup path uses:

1. environment loading (`dotenv`)
2. config staging into `.temp_custom_deps`
3. app-specific start script

## Config loading model

CLI and Discord runtimes load config from:

- `${MIMIR_CFG_PATH}/mimir-cfg.js` if present
- otherwise local default config (`src/default-config.ts`)

Root startup scripts set:

- `MIMIR_CFG_PATH=$INIT_CWD/.temp_custom_deps`

Staging script:

- `scripts/config-setup.js`
- copies user config from `mimir-config` (or `CONFIG_LOCAION`) into `.temp_custom_deps`

## Environment variables in active use

Common:

- `OPENAI_API_KEY`
- `MIMIR_CFG_PATH`
- `WORK_DIRECTORY` (optional persistent workspace root)
- `AGENT_OPENAI_MODEL`
- `AGENT_OPENAI_CHAT_TEMPERATURE`

Feature toggles in default configs:

- `CODE_INTERPRETER_PLUGIN=true|false`
- `WEB_BROWSER_PLUGIN=true|false`

Discord:

- `DISCORD_TOKEN`

MCP examples (LG server sample):

- `BRAVE_API_KEY`

## Workspace and file behavior

Default workspace implementation:

- `FileSystemAgentWorkspace` in `agent-mimir/src/nodejs/filesystem-work-directory.ts`

Behavior:

- each agent gets a root directory
- active workspace path is `<agentRoot>/workspace`
- `reset()` removes files in workspace directory
- shared files are copied into workspace on message ingest
- requested output files are resolved as local paths via `getUrlForFile`

## Threading and memory

Thread identity:

- orchestrator calls use explicit `threadId` strings
- CLI currently defaults to thread `"1"` for interactive loop

Memory backend:

- per agent graph compiled with checkpointer
- default `MemorySaver` if none provided

## Human-in-the-loop safety point

Both code and tool agents include human review node before executing tool calls.

Result:

- runtime can pause and ask for permission
- users can provide feedback instead of allowing execution

`continuousMode` behavior:

- CLI/Discord runtime config controls whether execution proceeds automatically after tool requests

## Build and test notes

Workspace build is orchestrated by Turbo at root:

- `npm run build`

Core library tests currently include plugin context coverage:

- `agent-mimir/src/plugins/context-provider.test.ts`

## Troubleshooting quick reference

### 1) Agent ignores config changes

Check:

- `mimir-config/mimir-cfg.js` exists
- startup script successfully copied config to `.temp_custom_deps`
- `MIMIR_CFG_PATH` points to staged directory

### 2) Workspace files not visible to agent

Check:

- file attached/shared in incoming message
- `workspace.loadFileToWorkspace(...)` succeeded
- workspace plugin is active (it is included by default in agent creation path)

### 3) Code execution does not run

Check:

- model output includes `<execution-code>`
- human review accepted tool request
- executor dependencies installed
- for docker executor: Docker CLI/daemon availability and port mapping permissions

### 4) Multi-agent routing not happening

Check:

- destination attribute present in response metadata
- target agent name exists in orchestrator registry
- communication whitelist includes destination (if whitelist is configured)
