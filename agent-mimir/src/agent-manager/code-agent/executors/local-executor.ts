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
}
export class LocalPythonExecutor implements CodeToolExecutor {

    private tempDir: string | undefined;
    private initialized: boolean = false;
    availableDependencies: string[] = this.config.additionalPackages ?? [];
    private workspace: AgentWorkspace | undefined = undefined;


    constructor(private config: PythonExecutorOptions) {
    }

    setWorkSpace(workspace: AgentWorkspace) {
        this.workspace = workspace;
    }

    async execute(tools: AgentTool[], code: string, toolInitCallback: (url: string, tools: AgentTool[]) => void): Promise<string> {

        if (!this.tempDir) {
            this.tempDir = "C:\\AI\\tmpws";
            //this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-python-code'));
        }

        const remoteWorkspacePath = (await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-python-code-ws'))).replace(/\\/g, '\\\\');
        let localWorkSpaceUrl = remoteWorkspacePath;
        let workspaceFiles: string[] = [];
        if (this.workspace) {
            workspaceFiles = await this.workspace.listFiles();
            localWorkSpaceUrl = this.workspace.workingDirectory;;
        }

        const wsPort = await getPortFree();
        const wsUrlBaseUrl = `ws://localhost:${wsPort}`;
        const wsUrl = `${wsUrlBaseUrl}/ws`;
        const wsWorkSpaceUrl = `${wsUrlBaseUrl}/ws2`;
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        const tempFileName = `script-${uniqueSuffix}.py`;
        const scriptPath = path.join(this.tempDir, tempFileName);
        const pythonScript = getPythonScript(wsPort, tools.map((t) => t.name), code, remoteWorkspacePath, workspaceFiles);
        await fs.writeFile(scriptPath, pythonScript);

        const scriptsDir = process.platform === "win32" ? 'Scripts' : 'bin';
        const activeScriptCall = process.platform === "win32" ? `activate` : `. ./activate`;


        try {

            //TODO REVERT
            if (!false) {

                console.debug(`Creating python virtual environment in ${this.tempDir} ...`);

                const pyenv = await executeShellCommand(`cd ${this.tempDir} && python -m venv .`);
                if (pyenv.exitCode !== 0) {
                    throw new Error(`Failed to create python virtual environment: ${pyenv.output}`);
                }

                const externalDependencies = ["nest_asyncio", "asyncio", "uvicorn", "fastapi_websocket_rpc", ...this.config.additionalPackages ?? []];

                let libraryInstallationResult = {
                    exitCode: 0,
                    output: "",
                }
                for (const libraryName of externalDependencies ?? []) {
                    console.debug(`Installing library ${libraryName}...`);
                    const installationResult = await executeShellCommand(`cd ${path.join(this.tempDir, scriptsDir)} && ${activeScriptCall} && python -m pip install ${libraryName}`);
                    if (installationResult.exitCode !== 0) {
                        libraryInstallationResult = {
                            exitCode: installationResult.exitCode,
                            output: installationResult.output + '\n------\n' + libraryInstallationResult.output,
                        }
                    }
                }
                if (libraryInstallationResult?.exitCode !== 0) {
                    console.warn(`Failed to install libraries:\n ${libraryInstallationResult?.output}`);
                }
                this.initialized = true;
            }

            let toolInitExecuted = false;
            const result = await executeShellCommandAndTrigger(`cd ${path.join(this.tempDir, scriptsDir)} && ${activeScriptCall} && python ${scriptPath}`, (data: string) => {
                if (data.includes("INITIALIZED SERVER") && !toolInitExecuted) {
                    console.log("STARTING TOOLS")
                    toolInitCallback(wsUrl, tools);
                    workspaceWs(wsWorkSpaceUrl, localWorkSpaceUrl, remoteWorkspacePath)
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
              //  await fs.rm(scriptPath, { force: true });
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



export async function workspaceWs(url: string, localWsPath: string, remoteWsPath: string) {
    let ws = new WebSocket(url, { perMessageDeflate: false });
    ws.on('open', function open(dc: any, f: any) {
        ws.on('message', async function (data: any) {
            const msg_options: Parameters<WebSocket["send"]>[1] = {}
            if (data instanceof ArrayBuffer) {
                msg_options.binary = true

                data = Buffer.from(data).toString()
            }

            const parsedData = JSON.parse(data as string) as PythonFunctionRequest

            let actualOutput;
            let error = false;
            try {
                if (parsedData.request.method === "load_file") {
                    const fileName = (parsedData.request.arguments as any).name as string
                    await fs.copyFile(path.join(localWsPath, fileName), path.join(remoteWsPath, fileName));
                } else if (parsedData.request.method === "save_file") {
                    const fileName = (parsedData.request.arguments as any).name as string
                    await fs.copyFile(path.join(remoteWsPath, fileName), path.join(localWsPath, fileName));
                }
                actualOutput = "success";
                error = false;
            } catch (e) {
                error = true;
                actualOutput = typeof e === "string" ? e : JSON.stringify(e);
            }

            ws.send(JSON.stringify({
                response: {
                    jsonrpc: "2.0",
                    result: {
                        error: error,
                        value: actualOutput
                    },
                    result_type: null,
                    call_id: parsedData.request.call_id,
                },
            }), msg_options)
        })
    });

    ws.on('close', function (event) {
        console.log('WebSocket closed:', event);
    });
}
type PythonFunctionRequest = {
    request: {
        method: string;
        arguments: Object;
        call_id: string;
    }
}
