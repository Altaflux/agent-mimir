# Parallel Search MCP example

This opt-in configuration gives a Mimir research assistant `web_search` and
`web_fetch` through the existing MCP client plugin and Streamable HTTP transport.
[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp) is free
without a Parallel API key for exploration and light use, with lower rate limits.
The anonymous endpoint uses Fast mode. Your chat and embedding provider still
requires its own credentials and may charge for inference.

## Run from a source checkout

Use Node.js 22 or later and run these commands from the repository root:

```sh
npm ci
npm run build
export OPENAI_API_KEY='your-provider-key'
export AGENT_OPENAI_MODEL='your-chosen-tool-calling-model'
CONFIG_LOCAION="$PWD/tool-examples/parallel-search" npm run start-web
```

`CONFIG_LOCAION` is the staging script's current spelling. The startup script
copies this directory into `.temp_custom_deps`, installs its declared
configuration dependencies, and loads `mimir-cfg.js` through `MIMIR_CFG_PATH`.
Select **Researcher** when creating a session in the web interface. Ask:

> Search for the official Model Context Protocol documentation. Fetch the relevant
> page and explain what Streamable HTTP does, citing the source URL.

Approve the requested tools in the interface. `continuousMode` stays false.
The plugin discovers the server's tools; their public names include the
`parallel__mcpClient` namespace. The response should include source URLs and
excerpts, which the assistant can use in its answer.

## Add it to an existing configuration

Copy the imports and the plugin entry from `mimir-cfg.js` into your async config
function and your agent's `definition.plugins` array. Keep your existing model,
embeddings and other plugins. The transport must be a **function** returning a
new transport for each plugin instance, since each session owns its connection.
The example sends `User-Agent: agent-mimir/parallel-search-example` and no
Authorization header. It doesn't read a Parallel key from the environment.

This example is only selected by the explicit `CONFIG_LOCAION` setting above.
Existing configurations and search tools are unchanged. To stop using it, start
Mimir with your previous configuration directory. If discovery fails or requests
are rate limited, inspect the MCP client errors in the server log; this example
adds no fallback provider or retry policy.
