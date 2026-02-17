import { AgentTool } from "../../../tools/index.js";
import { CodeToolExecutor } from "../index.js";
import os from "os";
import { promises as fs } from "fs";
import path from "path";
import { getPythonScript } from "./python-code.js";
import { spawn } from "child_process";
import net, { AddressInfo } from "net";
import crypto from "crypto";
import { AgentWorkspace } from "../../index.js";

export interface DockerPythonExecutorOptions {
    additionalPackages?: string[];
    workspace?: AgentWorkspace;
    dockerImage?: string;
    dockerBinary?: string;
    containerWorkspacePath?: string;
    containerRuntimePath?: string;
    streamContainerOutput?: boolean;
}

const DEFAULT_DOCKER_IMAGE = "python:3.14";
const DEFAULT_DOCKER_BINARY = "docker";
const DEFAULT_CONTAINER_WORKSPACE_PATH = "/workspace";
const DEFAULT_CONTAINER_RUNTIME_PATH = "/opt/mimir/runtime";

export class DockerPythonExecutor implements CodeToolExecutor {
    private tempDir: string | undefined;
    private initialized: boolean = false;
    private _installedLibraries: Set<string> = new Set();

    availableDependencies: string[];

    constructor(private config: DockerPythonExecutorOptions) {
        this.availableDependencies = config.additionalPackages ?? [];
    }

    workspaceFullPath(): string {
        return this.config.containerWorkspacePath ?? DEFAULT_CONTAINER_WORKSPACE_PATH;
    }

    async execute(
        tools: AgentTool[],
        code: string,
        libraries: string[],
        toolInitCallback: (url: string, tools: AgentTool[]) => void
    ): Promise<string> {
        const streamContainerOutput = this.config.streamContainerOutput ?? true;
        this.logInfo("Starting docker-based python execution.");

        if (!this.tempDir) {
            this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mimir-python-code-docker-"));
            this.logInfo(`Created runtime directory: ${this.tempDir}`);
        }

        const temporaryWorkspacePath = this.config.workspace
            ? undefined
            : await fs.mkdtemp(path.join(os.tmpdir(), "mimir-python-code-docker-ws-"));
        const hostWorkspacePath = this.config.workspace?.workingDirectory ?? temporaryWorkspacePath!;
        this.logInfo(`Using workspace directory: ${hostWorkspacePath}`);

        const wsPort = await getPortFree();
        const wsUrlBaseUrl = `ws://localhost:${wsPort}`;
        const wsUrl = `${wsUrlBaseUrl}/ws`;
        const uniqueSuffix = crypto.randomBytes(16).toString("hex");
        const tempFileName = `script-${uniqueSuffix}.py`;
        const scriptHostPath = path.join(this.tempDir, tempFileName);

        const pythonScript = getPythonScript(wsPort, tools.map((t) => t.name), code);
        await fs.writeFile(scriptHostPath, pythonScript);

        const dockerBinary = this.config.dockerBinary ?? DEFAULT_DOCKER_BINARY;
        const dockerImage = this.config.dockerImage ?? DEFAULT_DOCKER_IMAGE;
        const containerWorkspacePath = this.config.containerWorkspacePath ?? DEFAULT_CONTAINER_WORKSPACE_PATH;
        const containerRuntimePath = this.config.containerRuntimePath ?? DEFAULT_CONTAINER_RUNTIME_PATH;
        this.logInfo(`Docker image: ${dockerImage}`);
        this.logInfo(`Container workspace path: ${containerWorkspacePath}`);
        this.logInfo(`Container runtime path: ${containerRuntimePath}`);
        const containerScriptPath = path.posix.join(containerRuntimePath, tempFileName);
        const containerVenvPath = path.posix.join(containerRuntimePath, "venv");
        const containerActivatePath = path.posix.join(containerVenvPath, "bin/activate");

        const createDockerRunArgs = (command: string, publishedPort?: number): string[] => {
            const args: string[] = ["run", "--rm", "-i"];
            if (publishedPort !== undefined) {
                args.push("-p", `${publishedPort}:${publishedPort}`);
            }
            args.push(
                "-v",
                `${toDockerMountPath(this.tempDir!)}:${containerRuntimePath}`,
                "-v",
                `${toDockerMountPath(hostWorkspacePath)}:${containerWorkspacePath}`,
                "-w",
                containerWorkspacePath,
                dockerImage,
                "sh",
                "-lc",
                command
            );
            return args;
        };

        try {
            if (!this.initialized) {
                this.logInfo("Initializing python virtual environment inside docker runtime volume.");
                const initCommand = `set -e && python -m venv ${shellEscape(containerVenvPath)}`;
                const initResult = await executeCommand(dockerBinary, createDockerRunArgs(initCommand), {
                    label: "venv-init",
                    streamOutput: streamContainerOutput,
                });
                if (initResult.exitCode !== 0) {
                    throw new Error(
                        `Failed to create python virtual environment in docker image "${dockerImage}": ${initResult.output}`
                    );
                }
                this.initialized = true;
                this.logInfo("Python virtual environment initialized.");
            }

            const externalDependencies = [
                "nest_asyncio",
                "asyncio",
                "uvicorn",
                "fastapi_websocket_rpc",
                ...(libraries ?? []),
                ...(this.config.additionalPackages ?? []),
            ];
            const librariesToInstall = [...new Set(externalDependencies)]
                .filter((lib) => lib.trim().length > 0)
                .filter((lib) => !this._installedLibraries.has(lib));
            this.logInfo(
                librariesToInstall.length > 0
                    ? `Installing missing libraries: ${librariesToInstall.join(", ")}`
                    : "No new libraries to install. Reusing cached docker runtime environment."
            );

            if (librariesToInstall.length > 0) {
                let libraryInstallationResult = {
                    exitCode: 0,
                    output: "",
                };

                for (const libraryName of librariesToInstall) {
                    this.logInfo(`Installing library "${libraryName}"...`);
                    const installCommand = [
                        "set -e",
                        `. ${shellEscape(containerActivatePath)}`,
                        `python -m pip install ${shellEscape(libraryName)}`,
                    ].join(" && ");

                    const installResult = await executeCommand(dockerBinary, createDockerRunArgs(installCommand), {
                        label: `pip-install:${libraryName}`,
                        streamOutput: streamContainerOutput,
                    });
                    if (installResult.exitCode !== 0) {
                        libraryInstallationResult = {
                            exitCode: installResult.exitCode,
                            output: installResult.output + "\n------\n" + libraryInstallationResult.output,
                        };
                    } else {
                        this._installedLibraries.add(libraryName);
                        this.logInfo(`Library "${libraryName}" installed.`);
                    }
                }

                if (libraryInstallationResult.exitCode !== 0) {
                    this.logWarn(`Failed to install libraries in docker:\n${libraryInstallationResult.output}`);
                }
            }

            const runCommand = [
                "set -e",
                `. ${shellEscape(containerActivatePath)}`,
                `cd ${shellEscape(containerWorkspacePath)}`,
                `python ${shellEscape(containerScriptPath)}`,
            ].join(" && ");
            this.logInfo(`Running script in container. WebSocket port: ${wsPort}`);

            let toolInitExecuted = false;
            const result = await executeCommandAndTrigger(
                dockerBinary,
                createDockerRunArgs(runCommand, wsPort),
                {
                    label: "script-run",
                    streamOutput: streamContainerOutput,
                },
                (data: string) => {
                    if (data.includes("INITIALIZED SERVER") && !toolInitExecuted) {
                        this.logInfo("Python websocket server initialized. Tool bridge callback triggered.");
                        toolInitCallback(wsUrl, tools);
                        toolInitExecuted = true;
                        return true;
                    }
                    return false;
                }
            );

            this.logInfo(`Script execution finished with exit code: ${result.exitCode}`);
            return result.output;
        } catch (error) {
            this.logError("Error during docker execution.", error);
            return `Error: ${error}`;
        } finally {
            try {
                await fs.rm(scriptHostPath, { force: true });
                this.logInfo(`Removed temporary script file: ${scriptHostPath}`);
            } catch (error) {
                this.logWarn("Error removing docker script.", error);
            }

            if (temporaryWorkspacePath) {
                try {
                    await fs.rm(temporaryWorkspacePath, { recursive: true, force: true });
                    this.logInfo(`Removed temporary workspace directory: ${temporaryWorkspacePath}`);
                } catch (error) {
                    this.logWarn("Error removing temporary docker workspace.", error);
                }
            }
        }
    }

    private logInfo(message: string, ...args: unknown[]) {
        console.info(`[DockerPythonExecutor] ${message}`, ...args);
    }

    private logWarn(message: string, ...args: unknown[]) {
        console.warn(`[DockerPythonExecutor] ${message}`, ...args);
    }

    private logError(message: string, ...args: unknown[]) {
        console.error(`[DockerPythonExecutor] ${message}`, ...args);
    }
}

type CommandLogOptions = {
    label: string;
    streamOutput: boolean;
};

async function executeCommand(command: string, args: string[], options?: CommandLogOptions) {
    return await new Promise<{
        exitCode: number;
        output: string;
    }>((resolve) => {
        let output = "";
        const processHandle = spawn(command, args, { env: process.env });

        processHandle.stdout.on("data", (data) => {
            const text = data.toString();
            output += text;
            if (options?.streamOutput) {
                logStreamChunk("stdout", options.label, text);
            }
        });

        processHandle.stderr.on("data", (data) => {
            const text = data.toString();
            output += text;
            if (options?.streamOutput) {
                logStreamChunk("stderr", options.label, text);
            }
        });

        processHandle.on("error", (error) => {
            output += error.message;
            if (options?.streamOutput) {
                logStreamChunk("stderr", options.label, error.message);
            }
        });

        processHandle.on("close", (code) => {
            resolve({
                exitCode: code ?? 0,
                output: output,
            });
        });
    });
}

async function executeCommandAndTrigger(
    command: string,
    args: string[],
    options: CommandLogOptions,
    callback: (data: string) => boolean
) {
    let commenceRecording = false;
    return await new Promise<{
        exitCode: number;
        output: string;
    }>((resolve) => {
        let output = "";
        let totalOutput = "";
        const processHandle = spawn(command, args, { env: process.env });

        processHandle.stdout.on("data", (data) => {
            const text = data.toString();
            if (options.streamOutput) {
                logStreamChunk("stdout", options.label, text);
            }
            totalOutput += text;
            if (!commenceRecording) {
                commenceRecording = callback(text);
                return;
            }
            output += text;
        });

        processHandle.stderr.on("data", (data) => {
            const text = data.toString();
            if (options.streamOutput) {
                logStreamChunk("stderr", options.label, text);
            }
            totalOutput += text;
            if (!commenceRecording) {
                commenceRecording = callback(text);
                return;
            }
            output += text;
        });

        processHandle.on("error", (error) => {
            output += error.message;
            totalOutput += error.message;
            if (options.streamOutput) {
                logStreamChunk("stderr", options.label, error.message);
            }
        });

        processHandle.on("close", (code) => {
            resolve({
                exitCode: code ?? 0,
                output: commenceRecording ? output : totalOutput,
            });
        });
    });
}

function logStreamChunk(stream: "stdout" | "stderr", label: string, chunk: string) {
    const lines = chunk.split(/\r?\n/).filter((line) => line.length > 0);
    for (const line of lines) {
        console.info(`[DockerPythonExecutor][${label}][${stream}] ${line}`);
    }
}

async function getPortFree(): Promise<number> {
    return new Promise((res) => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const port = (srv.address()! as AddressInfo).port;
            srv.close(() => res(port));
        });
    });
}

function shellEscape(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function toDockerMountPath(hostPath: string): string {
    const normalizedPath = path.resolve(hostPath);
    return process.platform === "win32" ? normalizedPath.replace(/\\/g, "/") : normalizedPath;
}
