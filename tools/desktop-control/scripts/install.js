
import { spawn, exec } from 'child_process';
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
    const cudaVersion = await getCudaMajorVersion();
    const requirementFile = cudaVersion === 12 ? 'requirementsCuda12.txt' : cudaVersion === 11 ? 'requirementsCuda11.txt' : 'requirementsCpu.txt';

    const requirementsPath = path.resolve(process.cwd(), 'python', requirementFile);
    console.log("Installing requirements: " + requirementsPath);
    const result = await executeShellCommand(`cd ${path.join(pythonEnvironmentDir, scriptsDir)} && ${activeScriptCall} && python -m pip install -r ${requirementsPath}`)
    console.log(result.output)
    console.log("Finished installing requirements.")

    const pythonServerScript = path.resolve(process.cwd(), 'python', 'server.py');
    await fs.copyFile(pythonServerScript, path.join(dataDir, "server.py"));


    const mobileSam = path.resolve(process.cwd(), 'python', 'mobile_sam.pt');
    await fs.copyFile(mobileSam, path.join(dataDir, "mobile_sam.pt"));


    const dockerMolmo = path.resolve(process.cwd(), 'molmo', 'docker-compose.yml');
    await fs.copyFile(dockerMolmo, path.join(dataDir, 'docker-compose.yml'));

}


async function getCudaMajorVersion() {
    return new Promise((resolve, reject) => {
        try {
            let command = 'nvcc --version';

            exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    console.error('CUDA is not installed or not found in the system PATH.');
                    resolve(null);
                    return;
                }

                const output = stdout.trim();
                const match = output.match(/release (\d+)/);
                if (match) {
                    resolve(parseInt(match[1]));
                } else {
                    console.error('Unable to determine CUDA major version.');
                    resolve(null);
                }
            });
        } catch (error) {
            console.error('An error occurred while checking CUDA version:', error);
            reject(error);
        }
    });
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