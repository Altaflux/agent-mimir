import { AgentTool } from "../../../tools/index.js";
import { CodeToolExecutor } from "../index.js";
import os from 'os';
import { promises as fs } from 'fs';
import path from "path";
import { getPythonScript } from './pythonCode.js';
import { spawn } from 'child_process';


export class LocalPythonExecutor implements CodeToolExecutor {


    async execte(wsPort: number, tools: AgentTool[], code: string, toolInitCallback: (tools: AgentTool[]) => void): Promise<string> {

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mimir-code-interpreter-'));

        const scriptPath = path.join(tempDir, 'script.py');
        const pythonScript = getPythonScript(wsPort, tools.map((t) => t.name), code);
        await fs.writeFile(scriptPath, pythonScript);


        try {
            console.debug(`Creating python virtual environment in ${tempDir} ...`);
            const scriptsDir = process.platform === "win32" ? 'Scripts' : 'bin';
            const pyenv = await executeShellCommand(`cd ${tempDir} && python -m venv .`);
            if (pyenv.exitCode !== 0) {
                throw new Error(`Failed to create python virtual environment: ${pyenv.output}`);
            }

            const activeScriptCall = process.platform === "win32" ? `activate` : `. ./activate`;


            const externalDependencies = ["asyncio", "uvicorn", "fastapi_websocket_rpc"];

            let libraryInstallationResult = {
                exitCode: 0,
                output: "",
            }
            for (const libraryName of externalDependencies ?? []) {
                console.debug(`Installing library ${libraryName}...`);
                const installationResult = await executeShellCommand(`cd ${path.join(tempDir, scriptsDir)} && ${activeScriptCall} && python -m pip install ${libraryName}`);
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


            let toolInitExecuted = false;
            const result = await executeShellCommandAndTrigger(`cd ${path.join(tempDir, scriptsDir)} && ${activeScriptCall} && python ${scriptPath}`, (data: string) => {
                if (data.includes("INITIALIZED SERVER") && !toolInitExecuted) {
                    toolInitCallback(tools);
                    toolInitExecuted = true;
                    return true;
                }
                return false;
            });

            return result.output;

        } catch (error) {
            console.error('Error:', error);
            return `Error: ${error}`;
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
        const ls = spawn(command, [], { shell: true, env: process.env });
        ls.stdout.on("data", data => {
            if (!commenceRecording) {
                commenceRecording = callback(data.toString())
                return;
            }
            output += data;

        });

        ls.stderr.on("data", data => {
            if (!commenceRecording) {
                commenceRecording = callback(data.toString())
                return;
            }
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
