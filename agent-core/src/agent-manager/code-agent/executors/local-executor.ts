import { AgentTool } from "../../../tools/index.js";
import { CodeToolExecutor } from "../index.js";
import os from 'os';
import { promises as fs } from 'fs';
import path from "path";
import { getPythonScript } from './python-code.js';
import { spawn } from 'child_process';
import net, { AddressInfo } from "net";
import crypto from "crypto";
import { AgentWorkspace } from "../../index.js";

import WebSocket from 'ws';
export interface PythonExecutorOptions {
    additionalPackages?: string[];
    workspace?: AgentWorkspace
}
export class LocalPythonExecutor implements CodeToolExecutor {

    private tempDir: string | undefined;
    private initialized: boolean = false;
    private _installedLibraries: Set<string> = new Set();

    availableDependencies: string[];

    constructor(private config: PythonExecutorOptions) {
        this.availableDependencies = config.additionalPackages ?? []
    }

    workspaceFullPath(): string {
        return this.config.workspace?.workingDirectory ?? "";
    }

    async execute(tools: AgentTool[], code: string, libraries: string[], toolInitCallback: (url: string, tools: AgentTool[]) => void): Promise<string> {

        if (!this.tempDir) {
            this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-python-code'));
        }

        const temporaryWorkspacePath = (await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-python-code-ws'))).replace(/\\/g, '\\\\');
        let localWorkspaceUrl = temporaryWorkspacePath;
        if (this.config.workspace) {
            localWorkspaceUrl = this.config.workspace.workingDirectory;
        }

        const wsPort = await getPortFree();
        const wsUrlBaseUrl = `ws://localhost:${wsPort}`;
        const wsUrl = `${wsUrlBaseUrl}/ws`;
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        const tempFileName = `script-${uniqueSuffix}.py`;
        const scriptPath = path.join(this.tempDir, tempFileName);
        const pythonScript = getPythonScript(wsPort, tools.map((t) => t.name), code,);
        await fs.writeFile(scriptPath, pythonScript);

        const scriptsDir = process.platform === "win32" ? 'Scripts' : 'bin';
        const activeScriptCall = process.platform === "win32" ? `activate` : `. ./activate`;


        try {

            if (!this.initialized) {
                console.debug(`Creating python virtual environment in ${this.tempDir} ...`);
                const pyenv = await executeShellCommand(`cd ${this.tempDir} && python -m venv .`);
                if (pyenv.exitCode !== 0) {
                    throw new Error(`Failed to create python virtual environment: ${pyenv.output}`);
                }
                this.initialized = true;
            }

            const externalDependencies = ["nest-asyncio2", "asyncio", "uvicorn", "fastapi_websocket_rpc", ...libraries, ...this.config.additionalPackages ?? []];
            const librariesToInstall = externalDependencies.filter(lib => !this._installedLibraries.has(lib));

            if (librariesToInstall.length > 0) {
                let libraryInstallationResult = {
                    exitCode: 0,
                    output: "",
                }
                for (const libraryName of librariesToInstall) {
                    console.debug(`Installing library ${libraryName}...`);
                    const installationResult = await executeShellCommand(`cd ${path.join(this.tempDir, scriptsDir)} && ${activeScriptCall} && python -m pip install ${libraryName}`);
                    if (installationResult.exitCode !== 0) {
                        libraryInstallationResult = {
                            exitCode: installationResult.exitCode,
                            output: installationResult.output + '\n------\n' + libraryInstallationResult.output,
                        }
                    } else {
                        this._installedLibraries.add(libraryName);
                    }
                }
                if (libraryInstallationResult?.exitCode !== 0) {
                    console.warn(`Failed to install libraries:\n ${libraryInstallationResult?.output}`);
                }
            }

            let toolInitExecuted = false;
            const result = await executeShellCommandAndTrigger(`cd ${path.join(this.tempDir, scriptsDir)} && ${activeScriptCall} && cd ${localWorkspaceUrl} && python ${scriptPath}`, (data: string) => {
                if (data.includes("INITIALIZED SERVER") && !toolInitExecuted) {
                    toolInitCallback(wsUrl, tools);
                    toolInitExecuted = true;
                    return true;
                }
                return false;
            });

            return result.output;

        } catch (error) {
            console.error('Error:', error);
            return `Error: ${error}`;
        } finally {
            try {
                await fs.rm(scriptPath, { force: true });
            } catch (error) {
                console.warn('Error removing script:', error);
            }
        }

    }

}




async function executeShellCommandAndTrigger(command: string, callback: (data: string) => boolean) {
    let commenceRecording = false;
    return await new Promise<{
        exitCode: number,
        output: string,
    }>((resolve, reject) => {
        let output = '';
        let totalOutput = '';
        const ls = spawn(command, [], { shell: true, env: process.env });
        ls.stdout.on("data", data => {
            totalOutput += data;
            console.log(data.toString())
            if (!commenceRecording) {
                commenceRecording = callback(data.toString())
                return;
            }

            output += data;

        });

        ls.stderr.on("data", data => {
            totalOutput += data;
            console.log(data.toString())
            if (!commenceRecording) {
                commenceRecording = callback(data.toString())
                return;
            }

            output += data;

        });

        ls.on('error', (error) => {
            console.log(error.message)
            output += error.message;
        });

        ls.on("close", code => {

            resolve({
                exitCode: code ?? 0,
                output: commenceRecording ? output : totalOutput,
            })
        });
    });
}

async function executeShellCommand(command: string) {
    return await new Promise<{
        exitCode: number,
        output: string,
    }>((resolve, reject) => {
        let output = '';
        const ls = spawn(command, [], { shell: true, env: process.env });
        ls.stdout.on("data", data => {
            output += data;
        });

        ls.stderr.on("data", data => {
            output += data;
        });

        ls.on('error', (error) => {
            output += error.message;
        });

        ls.on("close", code => {
            resolve({
                exitCode: code ?? 0,
                output: output,
            })
        });
    });
}

async function getPortFree(): Promise<number> {
    return new Promise(res => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const port = (srv.address()! as AddressInfo).port
            srv.close((err) => res(port))
        });
    })
}

