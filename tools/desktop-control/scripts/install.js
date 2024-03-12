
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from "path";
import envPaths from 'env-paths';

async function start() {

    const dataDir = envPaths("mimir-desktop-control").data
    const pythonEnvironmentDir = path.join(dataDir, "pythonEnv");

    console.debug(`Creating python virtual environment in ${pythonEnvironmentDir} ...`);
    await fs.mkdir(pythonEnvironmentDir, { recursive: true });

    const scriptsDir = process.platform === "win32" ? 'Scripts' : 'bin';
    const pyenv = await executeShellCommand(`cd ${pythonEnvironmentDir} && python -m venv .`);


    const activeScriptCall = process.platform === "win32" ? `activate` : `. ./activate`;
    const requirementsPath = path.resolve(process.cwd(), 'python', 'requirements.txt');
    console.log("Installing requirements: " + requirementsPath);
    const result = await executeShellCommand(`cd ${path.join(pythonEnvironmentDir, scriptsDir)} && ${activeScriptCall} && python -m pip install -r ${requirementsPath}`)
    console.log(result.output)
    console.log("Finished installing requirements.")

    const pythonServerScript = path.resolve(process.cwd(), 'python', 'server.py');
    await fs.copyFile(pythonServerScript, path.join(dataDir, "server.py"));


    const mobileSam = path.resolve(process.cwd(), 'python', 'mobile_sam.pt');
    await fs.copyFile(mobileSam, path.join(dataDir, "mobile_sam.pt"));

}

async function executeShellCommand2(command) {
    const ls = spawn(command, [], { shell: true, env: process.env });
}

async function executeShellCommand(command) {
    return await new Promise((resolve, reject) => {
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

start()