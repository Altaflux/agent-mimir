import { MimirAgentPlugin, PluginContext, MimirPluginFactory, AgentCommand } from "agent-mimir/plugins";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { z } from "zod";
import { spawn } from 'child_process';
import os from 'os';
import { promises as fs } from 'fs';
import path from "path";
import { AgentTool, ToolResponse } from "agent-mimir/tools";
import { AgentWorkspace } from "agent-mimir/agent";

type CodeInterpreterArgs = {
    workSpace?: AgentWorkspace;
}


export class CodeInterpreterPluginFactory implements MimirPluginFactory {

    name: string = "codeInterpreter";

    async create(context: PluginContext): Promise<MimirAgentPlugin> {
        return new CodeInterpreterPlugin({ workSpace: context.workspace });
    }
}

class CodeInterpreterPlugin extends MimirAgentPlugin {
    private workSpace?: AgentWorkspace;
    constructor(private args: CodeInterpreterArgs) {
        super();
        this.workSpace = args.workSpace;
    }

    tools() {
        return [
            new PythonCodeInterpreter(this.workSpace?.workingDirectory),
        ];
    };

    async getCommands(): Promise<AgentCommand[]> {

        return [
            {
                name: "calculate_percent",
                description: "Calculate the percent of any number",
                arguments: [
                    {
                        name: "percent",
                        required: true,
                        description: "The percentage"
                    },
                    {
                        name: "number",
                        required: true,
                        description: "The number"
                    }
                ],
                commandHandler: async (args) => {
                    return [
                        {
                            type: "user",
                            content: [
                                {
                                    type: "text",
                                    text: "Use the code interpreter to calculate what is 15% of 76."
                                }
                            ]
                        }
                    ]
                }
            }
        ]
    }
}

class PythonCodeInterpreter extends AgentTool {

    private workDirectory?: string;

    schema = z.object({
        externalDependencies: z.array(z.string().describe("Name of a dependency to install.")).optional().describe("The list of external dependencies to download and install which are going to be required by the script."),
        code: z.string().describe("The python script code to run."),
    });
    description: string;

    constructor(workDirectory?: string) {
        super()
        this.workDirectory = workDirectory;
        this.description = `Code Interpreter to run a Python 3 script in the human's ${process.platform} computer. 
The input must be the content of the script to execute. The result of this function is the output of the console so you can use print statements to return information to yourself about the results. 
The interpreter has access to all the files in your workspace which can be accessed thru \"os.getenv('WORKSPACE')\". If you are given the task to create a file or they ask you to save it, then save the files inside the directory who's path is stored in the OS environment variable named "WORKSPACE" accessible like \"os.getenv('WORKSPACE')\". ` ;
    }

    name = "pythonCodeInterpreter";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<ToolResponse> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'python-code-interpreter-'));

        if (this.workDirectory) {
            await fs.mkdir(this.workDirectory, { recursive: true });
        }

        const scriptPath = path.join(tempDir, 'script.py');
        await fs.writeFile(scriptPath, arg.code);

        try {
            console.debug(`Creating python virtual environment in ${tempDir} ...`);
            const scriptsDir = process.platform === "win32" ? 'Scripts' : 'bin';
            const pyenv = await this.executeShellCommand(`cd ${tempDir} && python -m venv .`);
            if (pyenv.exitCode !== 0) {
                throw new Error(`Failed to create python virtual environment: ${pyenv.output}`);
            }


            await fs.appendFile(path.join(tempDir, scriptsDir, 'activate.bat'), `\nSET WORKSPACE=${this.workDirectory}\n`).catch(() => { console.warn("Failed to write to activate.bat") });
            await fs.appendFile(path.join(tempDir, scriptsDir, 'activate'), `\nexport WORKSPACE=${this.workDirectory}\n`).catch(() => { console.warn("Failed to write to activate") });;
            await fs.appendFile(path.join(tempDir, scriptsDir, 'Activate.ps1'), `\n$Env:WORKSPACE = "${this.workDirectory}"\n`).catch(() => { console.warn("Failed to write to Activate.ps1") });

            const activeScriptCall = process.platform === "win32" ? `activate` : `. ./activate`;

            const beforeExecutionOutputFileList = this.workDirectory ? await fs.readdir(this.workDirectory) : [];

            let libraryInstallationResult = {
                exitCode: 0,
                output: "",
            }
            for (const libraryName of arg?.externalDependencies ?? []) {
                console.debug(`Installing library ${libraryName}...`);
                const installationResult = await this.executeShellCommand(`cd ${path.join(tempDir, scriptsDir)} && ${activeScriptCall} && python -m pip install ${libraryName}`);
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

            const result = await this.executeShellCommand(`cd ${path.join(tempDir, scriptsDir)} && ${activeScriptCall} && cd ${this.workDirectory} && python ${scriptPath}`);

            let fileList = "";
            if (this.workDirectory) {
                const files = (await fs.readdir(this.workDirectory))
                    .filter(item => !beforeExecutionOutputFileList.includes(item));

                fileList = files.length === 0 ? "" : `The following files were created in the workspace: ${files.map((fileName: string) => `"${fileName}"`).join(" ")}`;
            }
            const dependenciesWarning = libraryInstallationResult?.exitCode !== 0 ? `\nWARNING: Failed to install libraries, if your script failed try to use an alternative library:\n ${libraryInstallationResult?.output}` : "";
            return [
                {
                    type: "text",
                    text: `Exit Code: ${result.exitCode} \n${fileList} \nScript Output:\n${result.output}` + dependenciesWarning
                }
            ]
        } catch (e) {

            return [
                {
                    type: "text",
                    text: "Failed to execute the script." + e
                }
            ]
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }


    async executeShellCommand(command: string) {
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
                const finalOutput = this.workDirectory ? output.replaceAll(this.workDirectory, "./WORKSPACE") : output;
                resolve({
                    exitCode: code ?? 0,
                    output: finalOutput,
                })
            });
        });
    }
}




