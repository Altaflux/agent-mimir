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
}

const DEFAULT_DOCKER_IMAGE = "python:3.12-slim";
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

    async execute(
        tools: AgentTool[],
        code: string,
        libraries: string[],
        toolInitCallback: (url: string, tools: AgentTool[]) => void
    ): Promise<string> {
        if (!this.tempDir) {
            this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mimir-python-code-docker-"));
        }

        const temporaryWorkspacePath = this.config.workspace
            ? undefined
            : await fs.mkdtemp(path.join(os.tmpdir(), "mimir-python-code-docker-ws-"));
        const hostWorkspacePath = this.config.workspace?.workingDirectory ?? temporaryWorkspacePath!;

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
                const initCommand = `set -e && python -m venv ${shellEscape(containerVenvPath)}`;
                const initResult = await executeCommand(dockerBinary, createDockerRunArgs(initCommand));
                if (initResult.exitCode !== 0) {
                    throw new Error(
                        `Failed to create python virtual environment in docker image "${dockerImage}": ${initResult.output}`
                    );
                }
                this.initialized = true;
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

            if (librariesToInstall.length > 0) {
                let libraryInstallationResult = {
                    exitCode: 0,
                    output: "",
                };

                for (const libraryName of librariesToInstall) {
                    const installCommand = [
                        "set -e",
                        `. ${shellEscape(containerActivatePath)}`,
                        `python -m pip install ${shellEscape(libraryName)}`,
                    ].join(" && ");

                    const installResult = await executeCommand(dockerBinary, createDockerRunArgs(installCommand));
                    if (installResult.exitCode !== 0) {
                        libraryInstallationResult = {
                            exitCode: installResult.exitCode,
                            output: installResult.output + "\n------\n" + libraryInstallationResult.output,
                        };
                    } else {
                        this._installedLibraries.add(libraryName);
                    }
                }

                if (libraryInstallationResult.exitCode !== 0) {
                    console.warn(`Failed to install libraries in docker:\n${libraryInstallationResult.output}`);
                }
            }

            const runCommand = [
                "set -e",
                `. ${shellEscape(containerActivatePath)}`,
                `cd ${shellEscape(containerWorkspacePath)}`,
                `python ${shellEscape(containerScriptPath)}`,
            ].join(" && ");

            let toolInitExecuted = false;
            const result = await executeCommandAndTrigger(
                dockerBinary,
                createDockerRunArgs(runCommand, wsPort),
                (data: string) => {
                    if (data.includes("INITIALIZED SERVER") && !toolInitExecuted) {
                        toolInitCallback(wsUrl, tools);
                        toolInitExecuted = true;
                        return true;
                    }
                    return false;
                }
            );

            return result.output;
        } catch (error) {
            console.error("Error:", error);
            return `Error: ${error}`;
        } finally {
            try {
                await fs.rm(scriptHostPath, { force: true });
            } catch (error) {
                console.warn("Error removing docker script:", error);
            }

            if (temporaryWorkspacePath) {
                try {
                    await fs.rm(temporaryWorkspacePath, { recursive: true, force: true });
                } catch (error) {
                    console.warn("Error removing temporary docker workspace:", error);
                }
            }
        }
    }
}

async function executeCommand(command: string, args: string[]) {
    return await new Promise<{
        exitCode: number;
        output: string;
    }>((resolve) => {
        let output = "";
        const processHandle = spawn(command, args, { env: process.env });

        processHandle.stdout.on("data", (data) => {
            output += data.toString();
        });

        processHandle.stderr.on("data", (data) => {
            output += data.toString();
        });

        processHandle.on("error", (error) => {
            output += error.message;
        });

        processHandle.on("close", (code) => {
            resolve({
                exitCode: code ?? 0,
                output: output,
            });
        });
    });
}

async function executeCommandAndTrigger(command: string, args: string[], callback: (data: string) => boolean) {
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
            totalOutput += text;
            if (!commenceRecording) {
                commenceRecording = callback(text);
                return;
            }
            output += text;
        });

        processHandle.stderr.on("data", (data) => {
            const text = data.toString();
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
        });

        processHandle.on("close", (code) => {
            resolve({
                exitCode: code ?? 0,
                output: commenceRecording ? output : totalOutput,
            });
        });
    });
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
