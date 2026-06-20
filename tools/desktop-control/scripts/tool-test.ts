import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { AgentWorkspace } from "@mimir/agent-core/agent";
import type { ComplexMessageContent } from "@mimir/agent-core/schema";
import type { AdditionalContent, AgentPlugin } from "@mimir/agent-core/plugins";
import {
  createStandaloneToolCallRuntimeContext,
  type AgentTool,
  type ToolResponse,
} from "@mimir/agent-core/tools";
import { DesktopControlPluginFactory } from "../src/index.js";
import type { DesktopControlOptions } from "../src/index.js";

type CliOptions = {
  help?: boolean;
  list?: boolean;
  mode?: string;
  tool?: string;
  input?: string;
  prepare?: boolean;
  saveDir?: string;
  pixelWidth?: string;
  steps?: string;
};

type StepsFile =
  | ToolTestStep[]
  | {
      mode?: string;
      pixelImageWidth?: number;
      steps: ToolTestStep[];
    };

type NormalizedToolTestStep =
  | { action: "prepare"; saveDir?: string }
  | { action: "tool"; tool: string; input?: unknown }
  | { action: "wait"; ms: number }
  | { action: "list" };

type ToolTestStep = NormalizedToolTestStep | { tool: string; input?: unknown };

const usage = `
Desktop control tool harness

Usage:
  npx tsx tools/desktop-control/scripts/tool-test.ts --list --mode PIXEL
  npx tsx tools/desktop-control/scripts/tool-test.ts --mode PIXEL --tool moveMouseLocationOnComputerScreenPixel --input '{"x":100,"y":100,"reason":"manual test"}'
  npx tsx tools/desktop-control/scripts/tool-test.ts --mode COORDINATES --tool moveMouseLocationOnComputerScreenGridCell --input '{"elementDescription":"target","gridCellNumber":42}'
  npx tsx tools/desktop-control/scripts/tool-test.ts --mode PIXEL --steps ./desktop-steps.json

  cd tools/desktop-control
  npm run tool-test -- PIXEL
  npm run tool-test -- PIXEL moveMouseLocationOnComputerScreenPixel '{"x":100,"y":100,"reason":"manual test"}'

Options:
  --mode PIXEL|COORDINATES|SOM   Mouse mode to instantiate. Defaults to PIXEL.
  --pixel-width 1024             Width for PIXEL mode screenshots. Defaults to 1024.
  --list                         List available tools and exit.
  --tool <name>                  Tool name to invoke. If omitted, tools are listed.
  --input '<json>'               JSON input passed to the selected tool. Defaults to {}.
  --steps <path>                 JSON file containing ordered prepare/tool/wait/list steps.
  --no-prepare                   Skip screenshot/context preparation before invoking the tool.
  --save-dir <path>              Save prepared context images to this directory.
  --help                         Show this help.

Steps file examples:
  [
    { "action": "prepare", "saveDir": "./desktop-test-output" },
    { "tool": "moveMouseLocationOnComputerScreenPixel", "input": { "x": 100, "y": 100, "reason": "manual test" } },
    { "tool": "mouseClickOnComputerScreen", "input": { "clickButton": "leftButton", "typeOfClick": "singleClick" } }
  ]

  {
    "mode": "PIXEL",
    "pixelImageWidth": 1024,
    "steps": [
      { "action": "prepare" },
      { "action": "wait", "ms": 500 },
      { "tool": "scrollComputerScreen", "input": { "direction": "down" } }
    ]
  }
`;

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    console.log(usage.trim());
    return;
  }

  const stepsFile = options.steps
    ? await loadStepsFile(options.steps)
    : undefined;

  const mode = parseMouseMode(options.mode ?? stepsFile?.mode ?? "PIXEL");
  const pluginOptions: DesktopControlOptions = {
    mouseMode: mode,
  };

  if (options.pixelWidth) {
    pluginOptions.pixelImageWidth = parsePositiveInteger(
      options.pixelWidth,
      "--pixel-width",
    );
  } else if (stepsFile?.pixelImageWidth !== undefined) {
    pluginOptions.pixelImageWidth = stepsFile.pixelImageWidth;
  }

  const factory = new DesktopControlPluginFactory(pluginOptions);
  const plugin = await factory.create({
    workspace: createWorkspaceStub(process.cwd()),
  });

  await plugin.init();
  try {
    const tools = await plugin.tools();
    const toolName = options.tool;

    if (stepsFile) {
      await runSteps({
        mode,
        plugin,
        tools,
        steps: stepsFile.steps,
        defaultSaveDir: options.saveDir,
      });
      return;
    }

    if (options.list || !toolName) {
      printTools(tools);
      if (!toolName) {
        return;
      }
    }

    const shouldPrepare = options.prepare !== false;
    if (shouldPrepare) {
      await prepareContext(plugin, mode, options.saveDir);
    }

    const input = parseToolInput(options.input ?? "{}");
    await invokeTool(tools, toolName, input);
  } finally {
    await plugin.destroy();
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--no-prepare") {
      options.prepare = false;
    } else if (arg === "--mode") {
      options.mode = readNextValue(argv, ++i, "--mode");
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
    } else if (arg === "--tool") {
      options.tool = readNextValue(argv, ++i, "--tool");
    } else if (arg.startsWith("--tool=")) {
      options.tool = arg.slice("--tool=".length);
    } else if (arg === "--input") {
      options.input = readNextValue(argv, ++i, "--input");
    } else if (arg.startsWith("--input=")) {
      options.input = arg.slice("--input=".length);
    } else if (arg === "--steps") {
      options.steps = readNextValue(argv, ++i, "--steps");
    } else if (arg.startsWith("--steps=")) {
      options.steps = arg.slice("--steps=".length);
    } else if (arg === "--save-dir") {
      options.saveDir = readNextValue(argv, ++i, "--save-dir");
    } else if (arg.startsWith("--save-dir=")) {
      options.saveDir = arg.slice("--save-dir=".length);
    } else if (arg === "--pixel-width") {
      options.pixelWidth = readNextValue(argv, ++i, "--pixel-width");
    } else if (arg.startsWith("--pixel-width=")) {
      options.pixelWidth = arg.slice("--pixel-width=".length);
    } else if (!arg.startsWith("--")) {
      positionals.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.mode && positionals[0]) {
    options.mode = positionals[0];
  }
  if (!options.steps && positionals[1]?.toLowerCase().endsWith(".json")) {
    options.steps = positionals[1];
  } else if (!options.tool && positionals[1]) {
    options.tool = positionals[1];
  }
  if (!options.input && positionals[2]) {
    options.input = positionals.slice(2).join(" ");
  }

  return options;
}

function readNextValue(
  argv: string[],
  index: number,
  optionName: string,
): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function parseMouseMode(mode: string): DesktopControlOptions["mouseMode"] {
  const normalized = mode.toUpperCase();
  if (
    normalized === "PIXEL" ||
    normalized === "COORDINATES" ||
    normalized === "SOM"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid --mode value: ${mode}. Expected PIXEL, COORDINATES, or SOM.`,
  );
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function parseToolInput(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`--input must be valid JSON. Received: ${input}`);
  }
}

async function loadStepsFile(
  filePath: string,
): Promise<{ mode?: string; pixelImageWidth?: number; steps: ToolTestStep[] }> {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as StepsFile;

  if (Array.isArray(parsed)) {
    return { steps: parsed };
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.steps)) {
    throw new Error(
      `Steps file must contain an array of steps or an object with a steps array: ${resolvedPath}`,
    );
  }

  if (
    parsed.pixelImageWidth !== undefined &&
    (!Number.isInteger(parsed.pixelImageWidth) || parsed.pixelImageWidth <= 0)
  ) {
    throw new Error(
      `steps.pixelImageWidth must be a positive integer: ${resolvedPath}`,
    );
  }

  return parsed;
}

async function runSteps(args: {
  mode: DesktopControlOptions["mouseMode"];
  plugin: AgentPlugin;
  tools: AgentTool[];
  steps: ToolTestStep[];
  defaultSaveDir?: string;
}) {
  for (const [index, step] of args.steps.entries()) {
    const stepNumber = index + 1;
    const normalizedStep = normalizeStep(step);
    console.log(
      `\nStep ${stepNumber}/${args.steps.length}: ${describeStep(normalizedStep)}`,
    );

    if (normalizedStep.action === "prepare") {
      await prepareContext(
        args.plugin,
        args.mode,
        normalizedStep.saveDir ?? args.defaultSaveDir,
      );
    } else if (normalizedStep.action === "tool") {
      await invokeTool(
        args.tools,
        normalizedStep.tool,
        normalizedStep.input ?? {},
      );
    } else if (normalizedStep.action === "wait") {
      await wait(normalizedStep.ms);
    } else if (normalizedStep.action === "list") {
      printTools(args.tools);
    }
  }
}

function normalizeStep(step: ToolTestStep): NormalizedToolTestStep {
  if (!step || typeof step !== "object") {
    throw new Error(`Each step must be an object.`);
  }

  if ("action" in step) {
    if (
      step.action === "prepare" ||
      step.action === "tool" ||
      step.action === "wait" ||
      step.action === "list"
    ) {
      return step;
    }
    throw new Error(
      `Unknown step action: ${(step as { action: unknown }).action}`,
    );
  }

  if ("tool" in step && typeof step.tool === "string") {
    return {
      action: "tool",
      tool: step.tool,
      input: step.input,
    };
  }

  throw new Error(`Step must specify either an action or a tool name.`);
}

function describeStep(step: NormalizedToolTestStep) {
  if (step.action === "tool") {
    return `tool ${step.tool}`;
  }
  if (step.action === "wait") {
    return `wait ${step.ms}ms`;
  }
  return step.action;
}

async function prepareContext(
  plugin: AgentPlugin,
  mode: DesktopControlOptions["mouseMode"],
  saveDir?: string,
) {
  console.log(`Preparing ${mode} screenshot context...`);
  const additionalContent = await plugin.additionalMessageContent({
    content: [],
  });
  printAdditionalContent(additionalContent);
  if (saveDir) {
    await saveAdditionalContentImages(additionalContent, saveDir);
  }
}

async function invokeTool(
  tools: AgentTool[],
  toolName: string,
  input: unknown,
): Promise<ToolResponse> {
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    printTools(tools);
    throw new Error(`Unknown tool: ${toolName}`);
  }

  console.log(`Invoking ${tool.name} with input:`);
  console.log(JSON.stringify(input, null, 2));

  const result = await tool.invoke(
    input as never,
    createStandaloneToolCallRuntimeContext(tool.name),
  );
  console.log("Tool response:");
  printContent(result);
  return result;
}

function wait(ms: number) {
  if (!Number.isInteger(ms) || ms < 0) {
    throw new Error(`Wait step ms must be a non-negative integer.`);
  }
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function printTools(tools: { name: string; description: string }[]) {
  console.log("Available tools:");
  for (const tool of tools) {
    console.log(`- ${tool.name}: ${tool.description}`);
  }
}

function printAdditionalContent(items: AdditionalContent[]) {
  console.log("Prepared context:");
  for (const [index, item] of items.entries()) {
    console.log(
      `Additional content ${index + 1}: saveToChatHistory=${item.saveToChatHistory}, displayOnCurrentMessage=${item.displayOnCurrentMessage}`,
    );
    printContent(item.content);
  }
}

function printContent(content: ComplexMessageContent[]) {
  for (const [index, part] of content.entries()) {
    if (part.type === "text") {
      console.log(`[${index}] text: ${part.text}`);
    } else if (part.type === "image") {
      console.log(
        `[${index}] image: mimeType=${part.mimeType ?? "unknown"}, base64Bytes=${part.data?.length ?? 0}`,
      );
    }
  }
}

async function saveAdditionalContentImages(
  items: AdditionalContent[],
  saveDir: string,
) {
  const resolvedDir = path.resolve(process.cwd(), saveDir);
  await mkdir(resolvedDir, { recursive: true });

  let imageIndex = 0;
  for (const item of items) {
    for (const part of item.content) {
      if (part.type !== "image") continue;
      if (!part.data) continue;
      imageIndex++;
      const extension = part.mimeType === "image/png" ? "png" : "jpg";
      const filePath = path.join(
        resolvedDir,
        `desktop-context-${imageIndex}.${extension}`,
      );
      await writeFile(filePath, Buffer.from(part.data, "base64"));
      console.log(`Saved ${filePath}`);
    }
  }
}

function createWorkspaceStub(workingDirectory: string): AgentWorkspace {
  return {
    workingDirectory,
    rootDirectory: workingDirectory,
    async listFiles() {
      return [];
    },
    async loadFileToWorkspace() {},
    async reset() {},
    async getUrlForFile() {
      return undefined;
    },
    async fileAsBuffer() {
      return undefined;
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
