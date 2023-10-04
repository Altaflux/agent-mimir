import { StructuredTool } from "langchain/tools";
import { MimirAgentPlugin } from "agent-mimir/schema";
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { z } from "zod";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { exec } from 'child_process';
import os from 'os';
import { promises as fs } from 'fs';
import path from "path";


export type CodeInterpreterArgs = {
    inputDirectory: string;
    outputDirectory: string;
}

const PROMPT = `
Code Interpreter Functions Instructions:
{interpreterInputFiles}

If you need to return files to the human when using the code-interpreter, please save it to the directory path saved in the environment variable named "OUTPUT_DIRECTORY".
End of Code Interpreter Functions Instructions.

`;

export type CodeInterpreterConfig = {
    inputDirectory: string;
    outputDirectory: string;
}
export class CodeInterpreterPlugin extends MimirAgentPlugin {

    constructor(private args: CodeInterpreterConfig) {
        super();
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(PROMPT),
        ];
    }

    async getInputs(): Promise<Record<string, any>> {
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
            interpreterInputFiles: `The human has given you access to the following files for you to use with the code interpreter functions. The files can be found inside a directory path saved in the environment variable named "INPUT_DIRECTORY". :\n${bulletedFiles}\n`,
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
        libraries: z.array(z.string()).optional().describe("The list of external libraries to download which are required by the script."),
        code: z.string().describe("The python script code to run."),
    });

    constructor(private inputDirectory: string, private outputDirectory: string) {
        super()
    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'python-code-interpreter-'));

        const scriptPath = path.join(tempDir, 'script.py');
        await fs.mkdir(this.inputDirectory, { recursive: true });
        await fs.mkdir(this.outputDirectory, { recursive: true });
        await fs.writeFile(scriptPath, arg.code);

        try {
            const pyenv = await executeShellCommand(`cd ${tempDir} && py -m venv .`);
            await fs.appendFile(path.join(tempDir, 'Scripts', 'activate.bat'), `\nSET INPUT_DIRECTORY=${this.inputDirectory}\nSET OUTPUT_DIRECTORY=${this.outputDirectory}\n`);
            await fs.appendFile(path.join(tempDir, 'Scripts', 'activate'), `\nexport INPUT_DIRECTORY=${this.inputDirectory}\nexport OUTPUT_DIRECTORY=${this.outputDirectory}\n`);
            await fs.appendFile(path.join(tempDir, 'Scripts', 'Activate.ps1'), `\n$Env:INPUT_DIRECTORY = "${this.inputDirectory}"\n$Env:OUTPUT_DIRECTORY = "${this.outputDirectory}"\n`)

            
            const libraryList = arg.libraries?.join(" ");
            const pyInstall = await executeShellCommand(`cd ${path.join(tempDir, 'Scripts')} && activate && py -m pip install ${libraryList}`);
            const result = await executeShellCommand(`cd ${path.join(tempDir, 'Scripts')} && activate && py ${scriptPath}`);
            return result.length > 0 ? result : "The script ran successfully.";
        } catch (e) {
            return "Failed to execute the script." + e;
        } finally {
            await fs.unlink(scriptPath);
        }
    }
    name = "pythonCodeInterpreter";
    description = "Code Interpreter to run a Python 3 script in the human's computer. The input must be the content of the script to execute. The result of this function is the output of the console so you can use print statements to return information to yourself if needed.";
}



async function executeShellCommand(command: string) {
    const result = await new Promise<string>((resolve, reject) => {
        exec(`${command}`, {}, (error, stdout, stderr) => {
            if (error) {
                resolve(error.message)
            } else if (stderr) {
                resolve(stdout);
            } else {
                resolve(stdout);
            }
        })
    });

    return result;
}