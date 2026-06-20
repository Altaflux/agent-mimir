import { z } from "zod/v4";
import type { AgentPlugin, PluginFactory } from "../../../plugins/index.js";
import {
  AgentTool,
  createStandaloneToolCallRuntimeContext,
  type ToolCallRuntimeContext,
} from "../../../tools/index.js";
import type { RuntimePluginToolEntry } from "../../runtime-tools.js";
import { LocalPythonExecutor } from "./local-executor.js";

class MockTool extends AgentTool {
  name = "mock_tool";
  description = "mock tool";
  schema = z.object({});

  protected async _call(
    _arg: z.output<this["schema"]>,
    _context: ToolCallRuntimeContext,
  ) {
    return [{ type: "text" as const, text: "mock result" }];
  }
}

function standaloneEntry(tools: AgentTool[]): RuntimePluginToolEntry {
  return {
    entry: {
      plugin: {} as AgentPlugin,
      pluginId: "verify-executor",
      pluginNamespace: "verify_executor",
      factory: {} as PluginFactory,
      label: "Verify Executor",
      toolRuntime: {
        forToolCall(source) {
          return createStandaloneToolCallRuntimeContext(
            source.toolName,
            source,
          );
        },
      },
    },
    tools,
  };
}

async function runTest() {
  console.log("Starting Verification Test...");

  const executor = new LocalPythonExecutor({
    additionalPackages: [],
  });

  const plugins = standaloneEntry([new MockTool()]);
  const code = "print('Hello World')";
  const callback = () => {
    return;
  };

  console.log("\n--- Execution 1: Installing 'requests' ---");
  await executor.execute([plugins], code, ["requests"], callback);

  console.log("\n--- Execution 2: 'requests' again ---");
  await executor.execute([plugins], code, ["requests"], callback);

  console.log("\n--- Execution 3: 'requests' and 'colorama' ---");
  await executor.execute([plugins], code, ["requests", "colorama"], callback);

  console.log("\nTest Complete.");
}

runTest().catch(console.error);
