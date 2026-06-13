import { AgentTool, PublicNamedAgentTool } from "../tools/index.js";
import {
  createPluginLabel,
  createPluginNamespace,
  createPluginToolName,
  PluginConfig,
  PluginFactory,
  PluginRuntimeBindingIdentity,
  validatePluginIdentifier,
} from "../plugins/index.js";

export type NormalizedPluginConfig = PluginRuntimeBindingIdentity & {
  factory: PluginFactory;
  label: string;
  description?: string;
  displayName?: string;
};

export function createInternalPlugin(
  factory: PluginFactory,
): PluginConfig[number] {
  return {
    factory,
  };
}

export function normalizePluginConfig(
  plugins: PluginConfig | undefined,
  builtIns: PluginConfig = [],
): NormalizedPluginConfig[] {
  const entries = [...(plugins ?? []), ...builtIns].map((config) => {
    const pluginId = config.factory.pluginId;
    const prefix = config.prefix?.trim() || undefined;

    validatePluginIdentifier(pluginId, "pluginId");
    if (prefix) {
      validatePluginIdentifier(prefix, "plugin prefix");
    }

    const pluginNamespace = createPluginNamespace(pluginId, prefix);
    return {
      factory: config.factory,
      pluginId,
      pluginPrefix: prefix,
      description: config.description,
      pluginNamespace,
      label: createPluginLabel(pluginId, prefix),
      displayName: config.factory.displayName,
    };
  });

  assertDuplicatePluginIdsArePrefixed(entries);
  assertUniquePluginNamespaces(entries);
  return entries;
}

export function createPublicPluginTool(
  pluginNamespace: string,
  tool: AgentTool,
): AgentTool {
  return new PublicNamedAgentTool(
    tool,
    createPluginToolName(pluginNamespace, tool.name),
  );
}

export function assertUniqueToolNames(tools: AgentTool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate public tool name "${tool.name}".`);
    }
    seen.add(tool.name);
  }
}

function assertDuplicatePluginIdsArePrefixed(
  entries: NormalizedPluginConfig[],
): void {
  const entriesByPluginId = new Map<string, NormalizedPluginConfig[]>();
  for (const entry of entries) {
    entriesByPluginId.set(entry.pluginId, [
      ...(entriesByPluginId.get(entry.pluginId) ?? []),
      entry,
    ]);
  }

  for (const [pluginId, duplicateEntries] of entriesByPluginId) {
    if (
      duplicateEntries.length > 1 &&
      duplicateEntries.some((entry) => !entry.pluginPrefix)
    ) {
      throw new Error(
        `Plugin "${pluginId}" is configured more than once. Every repeated plugin instance must declare a unique prefix.`,
      );
    }
  }
}

function assertUniquePluginNamespaces(entries: NormalizedPluginConfig[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.pluginNamespace)) {
      throw new Error(`Duplicate plugin namespace "${entry.pluginNamespace}".`);
    }
    seen.add(entry.pluginNamespace);
  }
}
