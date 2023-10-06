import { StructuredTool } from "langchain/tools";
import { MimirAgentPlugin } from "agent-mimir/schema";
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { z } from "zod";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { spawn } from 'child_process';
import os from 'os';
import { promises as fs } from 'fs';
import path from "path";



export type CodeInterpreterArgs = {
    inputDirectory?: string;
    outputDirectory?: string;
}

const CODE_INTERPRETER_PROMPT = function (args: CodeInterpreterArgs) {
    return `
Code Interpreter Functions Instructions:
{interpreterInputFiles}

${args.outputDirectory ? `If you are given the task to create a file or they ask you to save it then save the files inside the directory who's path is stored in the OS environment variable named "OUTPUT_DIRECTORY" like \"os.getenv('OUTPUT_DIRECTORY')\".` : ""}
End of Code Interpreter Functions Instructions.

`
};

export class CodeInterpreterPlugin extends MimirAgentPlugin {

    constructor(private args: CodeInterpreterArgs) {
        super();
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(CODE_INTERPRETER_PROMPT(this.args)),
        ];
    }

    async getInputs(): Promise<Record<string, any>> {
        if (!this.args.inputDirectory) {
            return {
                interpreterInputFiles: "",
            };
        }
        const files = await fs.readdir(this.args.inputDirectory);
        if (files.length === 0) {
            return {
                interpreterInputFiles: "",
            };
        }
        const bulletedFiles = (files)
            .map((fileName: string) => `- "${fileName}"`)
            .join("\n");
        return {
            interpreterInputFiles: `You have been given access to the following files for you to use with the code interpreter functions. The files can be found inside a directory path stored in the OS environment variable named "INPUT_DIRECTORY" accessible like \"os.getenv('INPUT_DIRECTORY')\". :\n${bulletedFiles}\n`,
        };
    }

    tools() {
        return [
            new PythonCodeInterpreter(this.args.inputDirectory, this.args.outputDirectory),
        ];
    };
}

class PythonCodeInterpreter extends StructuredTool {

    schema = z.object({
        externalLibraries: z.array(z.string()).optional().describe("The list of external libraries to download which are required by the script."),
        code: z.string().describe("The python script code to run."),
    });
    description: string;

    constructor(private inputDirectory?: string, private outputDirectory?: string) {
        super()

        this.description = `Code Interpreter to run a Python 3 script in the human's ${process.platform} computer. 
The input must be the content of the script to execute. The result of this function is the output of the console so you can use print statements to return information to yourself about the results. 
If you are given the task to create a file or they ask you to save it then save the files inside the directory who's path is stored in the OS environment variable named "OUTPUT_DIRECTORY" accessible like \"os.getenv('OUTPUT_DIRECTORY')\". ` ;

    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'python-code-interpreter-'));

        const scriptPath = path.join(tempDir, 'script.py');
        if (this.inputDirectory) {
            await fs.mkdir(this.inputDirectory, { recursive: true });
        }
        if (this.outputDirectory) {
            await fs.mkdir(this.outputDirectory, { recursive: true });

        }
        await fs.writeFile(scriptPath, arg.code);

        try {
            console.debug(`Creating python virtual environment in ${tempDir} ...`);
            const pyenv = await executeShellCommand(`cd ${tempDir} && py -m venv .`);
            if (pyenv.exitCode !== 0) {
                throw new Error(`Failed to create python virtual environment: ${pyenv.output}`);
            }
            await fs.appendFile(path.join(tempDir, 'Scripts', 'activate.bat'), `\nSET INPUT_DIRECTORY=${this.inputDirectory}\nSET OUTPUT_DIRECTORY=${this.outputDirectory}\n`);
            await fs.appendFile(path.join(tempDir, 'Scripts', 'activate'), `\nexport INPUT_DIRECTORY=${this.inputDirectory}\nexport OUTPUT_DIRECTORY=${this.outputDirectory}\n`);
            await fs.appendFile(path.join(tempDir, 'Scripts', 'Activate.ps1'), `\n$Env:INPUT_DIRECTORY = "${this.inputDirectory}"\n$Env:OUTPUT_DIRECTORY = "${this.outputDirectory}"\n`)

            const activeScriptCall = process.platform === "win32" ? `activate` : `./activate`;

            const beforeExecutionOutputFileList = this.outputDirectory ? await fs.readdir(this.outputDirectory) : [];

            let libraryInstallationResult = {
                exitCode: 0,
                output: "",
            }
            for (const libraryName of arg?.externalLibraries ?? []) {
                console.debug(`Installing library ${libraryName}...`);
                const installationResult = await executeShellCommand(`cd ${path.join(tempDir, 'Scripts')} && ${activeScriptCall} && py -m pip install ${libraryName}`);
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

            const result = await executeShellCommand(`cd ${path.join(tempDir, 'Scripts')} && ${activeScriptCall} && py ${scriptPath}`);

            let fileList = "";
            if (this.outputDirectory) {
                const files = (await fs.readdir(this.outputDirectory))
                    .filter(item => !beforeExecutionOutputFileList.includes(item));

                fileList = files.length === 0 ? "" : `The following files were created in the output directory: ${files.map((fileName: string) => `"${fileName}"`).join(" ")}`;
            }

            return `Exit Code: ${result.exitCode} \n${fileList} \nScript Output:\n${result.output}`
        } catch (e) {
            return "Failed to execute the script." + e;
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }
    name = "pythonCodeInterpreter";

}



async function executeShellCommand(command: string) {
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
            resolve({
                exitCode: code ?? 0,
                output: output,
            })
        });
    });
}
