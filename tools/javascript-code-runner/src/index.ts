import { NodeVM } from "vm2";

import { StructuredTool } from "langchain/tools";
import { CallbackManagerForToolRun } from "langchain/dist/callbacks";
import { z } from "zod";

export class JavascriptCodeRunner extends StructuredTool {
    schema = z.object({
        code: z.string().describe("The javascript code to run. Use a \"return\" statement to return the result."),
    });

    protected async _call(arg: z.input<this["schema"]>, runManager?: CallbackManagerForToolRun | undefined): Promise<string> {
        const vm = new NodeVM({
            allowAsync: false,
            wrapper: "none",
            sandbox: {},
        });
        const result = vm.run(arg.code);
        return JSON.stringify(result);
    }

    name: string = "javascript-code-runner";
    description: string = "Runs javascript code in a sandboxed environment. Useful for when you need to do calculations, or run some code.";
}