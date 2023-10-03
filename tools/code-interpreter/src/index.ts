import { StructuredTool } from "langchain/tools";
import { MimirAgentPlugin } from "agent-mimir/schema";
import { CallbackManagerForToolRun } from "langchain/callbacks";
import { z } from "zod";
import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { exec, spawn } from 'child_process';

import { promises as fs } from 'fs';

export type CodeInterpreterArgs = {
    inputDirectory: string;
    outputDirectory: string;
}
class CodeInterpreterManager {

    async getInputFiles(): Promise<string[]> {
        return [];
    }

}

const PROMPT = `
Code Interpreter Functions Instructions:
{interpreterInputFiles}

If you need to return files to the human when using the code-interpreter, please save it to the directory path saved in the variable named "outputDirectory".
End of Code Interpreter Functions Instructions.

`;

export class CodeInterpreterPlugin extends MimirAgentPlugin {
    constructor() {
        super();
    }

    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(PROMPT),
        ];
    }

    async getInputs(): Promise<Record<string, any>> {
        const files = await fs.readdir("C:/AI/interpreter/in");
        if (files.length === 0) {
            return {
                interpreterInputFiles: "",
            };
        }
        const bulletedFiles = (files)
            .map((fileName: string) => `- "${fileName}"`)
            .join("\n");
        return {
            interpreterInputFiles: `The human has given you access to the following files for you to use with the code interpreter functions. The files can be found inside a directory path saved in the variable named "inputDirectory". :\n${bulletedFiles}\n`,
        };
    }

    tools() {
        return [
            new PythonCodeInterpreter("C:/AI/interpreter/"),
        ];
    };
}

class PythonCodeInterpreter extends StructuredTool {

    schema = z.object({
        libraries: z.array(z.string()).optional().describe("The libraries to import. For example, \"import os\" would be \"os\"."),
        code: z.string().describe("The javascript code to run. Always use a \"return\" statement to return the result."),
    });

    constructor(private workingDirectory: string) {
        super()
    }

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const scriptPath = `${this.workingDirectory}/script.py`
        const codeToRun = `
inputDirectory = "C:/AI/interpreter/in/"
outputDirectory = "C:/AI/interpreter/out/"

${arg.code}`;
        console.log(codeToRun);
        await fs.writeFile(scriptPath, codeToRun);

        // const result = await new Promise<string>((resolve, reject) => {
        //     exec(`python ${scriptPath}`, {}, (error, stdout, stderr) => {
        //         if (error) {
        //             resolve(error.message)
        //         }
        //         else if (stderr) {
        //             resolve(stdout)
        //         } else {

        //             resolve(stdout)
        //         }
        //     })
        // });
        await fs.unlink(scriptPath);
        //return result;
        return `Success!`;
    }
    name = "pythonCodeInterpreter";
    description = "Code Interpreter to run a Python script in the human's computer. The input must be the content of the script to execute.";


}

