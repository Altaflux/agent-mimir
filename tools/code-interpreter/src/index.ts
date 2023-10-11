import { StructuredTool } from "langchain/tools";
import { MimirAgentPlugin, PluginContext, MimirPluginFactory } from "agent-mimir/schema";
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { z } from "zod";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { spawn } from 'child_process';
import os from 'os';
import { promises as fs } from 'fs';
import path from "path";



type CodeInterpreterArgs = {
    workDirectory?: string;
}

const CODE_INTERPRETER_PROMPT = function (args: CodeInterpreterArgs) {
    return `
Code Interpreter Functions Instructions:
{interpreterInputFiles}

If you are given the task to create a file or they ask you to save it then save the files inside the directory who's path is stored in the OS environment variable named "WORK_DIRECTORY" like \"os.getenv('WORK_DIRECTORY')\".
Do not mention the work directory in your conversations.

End of Code Interpreter Functions Instructions.

`
};


export class CodeInterpreterPluginFactory implements MimirPluginFactory {
    create(context: PluginContext): MimirAgentPlugin {
        return new CodeInterpreterPlugin({ workDirectory: context.workingDirectory });
    }
}

class CodeInterpreterPlugin extends MimirAgentPlugin {
    private workDirectory?: string;
    constructor(private args: CodeInterpreterArgs) {
        super();
        this.workDirectory = args.workDirectory;
    }

    async init(): Promise<void> {
        if (this.workDirectory) {
            await fs.mkdir(this.workDirectory, { recursive: true });
            console.debug(`Code Interpreter Plugin initialized with work directory ${this.workDirectory}`);
        }
    }
    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(CODE_INTERPRETER_PROMPT(this.args)),
        ];
    }

    async getInputs(): Promise<Record<string, any>> {
        if (!this.workDirectory) {
            return {
                interpreterInputFiles: "",
            };
        }
        const files = await fs.readdir(this.workDirectory);
        if (files.length === 0) {
            return {
                interpreterInputFiles: "",
            };
        }
        const bulletedFiles = (files)
            .map((fileName: string) => `- "${fileName}"`)
            .join("\n");
        return {
            interpreterInputFiles: `You have been given access to the following files for you to use with the code interpreter functions. The files can be found inside a directory path stored in the OS environment variable named "WORK_DIRECTORY" accessible like \"os.getenv('WORK_DIRECTORY')\". :\n${bulletedFiles}\n`,
        };
    }

    tools() {
        return [
            new PythonCodeInterpreter(this.workDirectory),
        ];
    };
}

class PythonCodeInterpreter extends StructuredTool {

    private workDirectory?: string;

    schema = z.object({
        externalLibraries: z.array(z.string()).optional().describe("The list of external libraries to download which are required by the script."),
        code: z.string().describe("The python script code to run."),
    });
    description: string;

    constructor(workDirectory?: string) {
        super()
        this.workDirectory = workDirectory;
        this.description = `Code Interpreter to run a Python 3 script in the human's ${process.platform} computer. 
The input must be the content of the script to execute. The result of this function is the output of the console so you can use print statements to return information to yourself about the results. 
If you are given the task to create a file or they ask you to save it then save the files inside the directory who's path is stored in the OS environment variable named "WORK_DIRECTORY" accessible like \"os.getenv('WORK_DIRECTORY')\". ` ;
    }

    name = "pythonCodeInterpreter";

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'python-code-interpreter-'));

        if (this.workDirectory) {
            await fs.mkdir(this.workDirectory, { recursive: true });
        }

        const scriptPath = path.join(tempDir, 'script.py');
        await fs.writeFile(scriptPath, arg.code);

        try {
            console.debug(`Creating python virtual environment in ${tempDir} ...`);
            const pyenv = await this.executeShellCommand(`cd ${tempDir} && py -m venv .`);
            if (pyenv.exitCode !== 0) {
                throw new Error(`Failed to create python virtual environment: ${pyenv.output}`);
            }
            await fs.appendFile(path.join(tempDir, 'Scripts', 'activate.bat'), `\nSET WORK_DIRECTORY=${this.workDirectory}\n`);
            await fs.appendFile(path.join(tempDir, 'Scripts', 'activate'), `\nexport WORK_DIRECTORY=${this.workDirectory}\n`);
            await fs.appendFile(path.join(tempDir, 'Scripts', 'Activate.ps1'), `\n$Env:WORK_DIRECTORY = "${this.workDirectory}"\n`)

            const activeScriptCall = process.platform === "win32" ? `activate` : `./activate`;

            const beforeExecutionOutputFileList = this.workDirectory ? await fs.readdir(this.workDirectory) : [];

            let libraryInstallationResult = {
                exitCode: 0,
                output: "",
            }
            for (const libraryName of arg?.externalLibraries ?? []) {
                console.debug(`Installing library ${libraryName}...`);
                const installationResult = await this.executeShellCommand(`cd ${path.join(tempDir, 'Scripts')} && ${activeScriptCall} && py -m pip install ${libraryName}`);
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

            const result = await this.executeShellCommand(`cd ${path.join(tempDir, 'Scripts')} && ${activeScriptCall} && py ${scriptPath}`);

            let fileList = "";
            if (this.workDirectory) {
                const files = (await fs.readdir(this.workDirectory))
                    .filter(item => !beforeExecutionOutputFileList.includes(item));

                fileList = files.length === 0 ? "" : `The following files were created in the work directory: ${files.map((fileName: string) => `"${fileName}"`).join(" ")}`;
            }

            return `Exit Code: ${result.exitCode} \n${fileList} \nScript Output:\n${result.output}`
        } catch (e) {
            return "Failed to execute the script." + e;
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
            const ls = spawn(command, [], { shell: true });
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
                const finalOutput = this.workDirectory ? output.replaceAll(this.workDirectory, "./WORK_DIRECTORY") : output;
                resolve({
                    exitCode: code ?? 0,
                    output: finalOutput,
                })
            });
        });
    }
}




