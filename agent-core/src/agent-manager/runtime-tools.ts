import type { AgentPlugin, PluginFactory } from "../plugins/index.js";
import type {
  AgentTool,
  ToolInputSchemaBase,
  ToolRuntimeProvider,
} from "../tools/index.js";

export type RuntimePluginEntry = {
  plugin: AgentPlugin;
  pluginId: string;
  pluginPrefix?: string;
  pluginNamespace: string;
  factory: PluginFactory;
  label: string;
  description?: string;
  displayName?: string;
  toolRuntime: ToolRuntimeProvider;
};

export type RuntimePluginToolEntry = {
  entry: RuntimePluginEntry;
  tools: AgentTool<ToolInputSchemaBase, any, any>[];
};

export type RuntimeToolEntry = {
  entry: RuntimePluginEntry;
  tool: AgentTool<ToolInputSchemaBase, any, any>;
};

export function listRuntimeToolEntries(
  plugins: RuntimePluginToolEntry[],
): RuntimeToolEntry[] {
  return plugins.flatMap((plugin) =>
    plugin.tools.map((tool) => ({
      entry: plugin.entry,
      tool,
    })),
  );
}

export function findRuntimeToolEntry(
  plugins: RuntimePluginToolEntry[],
  toolName: string,
): RuntimeToolEntry | undefined {
  return listRuntimeToolEntries(plugins).find(
    (entry) => entry.tool.name === toolName,
  );
}
