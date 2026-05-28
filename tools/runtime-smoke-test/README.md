# Runtime Smoke Test Plugin

Dummy plugin for verifying plugin runtime events and the manual notification inbox.

## Config

```js
const { RuntimeSmokeTestPluginFactory } = await import("@mimir/runtime-smoke-test");

plugins: [
    new RuntimeSmokeTestPluginFactory()
]
```

## Test Prompt

Ask the agent:

```text
Use the runtime smoke test tool with label "inbox demo", 4 steps, and then stop.
```

Expected behavior:

- Tool-scoped `plugin_event` status/progress/message events appear in the UI.
- A `plugin_notification` event appears.
- The composer shows a pending notification banner.
- Clicking `Process` routes the queued notification to the principal agent.
