import type { RuntimePluginToolEntry } from "../runtime-tools.js";
export { LocalPythonExecutor } from "./executors/local-executor.js";
export { DockerPythonExecutor } from "./executors/docker-executor.js";
export { CodeAgentFactory } from "./factory.js";
export { createAgent, createLgAgent } from "./agent.js";

export interface CodeToolExecutor {
  availableDependencies: string[];

  workspaceFullPath(): string;

  execute(
    plugins: RuntimePluginToolEntry[],
    code: string,
    libraries: string[],
    toolInitCallback: (
      wsUrl: string,
      plugins: RuntimePluginToolEntry[],
    ) => void,
  ): Promise<string>;
}
