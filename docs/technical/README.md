# Agent Mimir Technical Documentation

This documentation describes the current technical design of the repository, with one explicit scope boundary:

- Included: core runtime and applications (`agent-mimir`, `agent-mimir-cli`, `agent-mimir-discord`, `lg-server`, root scripts/config flow)
- Excluded: workspace packages under the root `tools/` directory

If you are onboarding, read in this order:

1. `docs/technical/architecture.md`
2. `docs/technical/agent-runtime.md`
3. `docs/technical/code-execution.md`
4. `docs/technical/configuration-and-ops.md`
5. `docs/technical/source-map.md`

Related existing doc:

- `agent-mimir/docs/plugin-system.md` (plugin API details and examples)

## Why this set exists

The goal is to provide a single technical reference that is accurate to the current codebase, useful for:

- humans maintaining/extending the system
- automated agents that need grounded context before code changes

## Repository scope summary

- `agent-mimir`: core library (agents, orchestration, plugins, workspace, formatting, schema)
- `agent-mimir-cli`: terminal chat app wired to core library
- `agent-mimir-discord`: Discord bot app wired to core library
- `lg-server`: LangGraph server entrypoint wrapping a preconfigured core agent
- Root scripts: config bootstrapping and workspace build/run scripts
