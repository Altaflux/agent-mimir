
import { zodToJsonSchema } from "zod-to-json-schema";
import { AgentTool } from "../../tools/index.js";
export const FUNCTION_PROMPT = `
You are an expert assistant who can solve any task using code blobs. You will be given a task to solve as best you can.
To do so, you have been given access to a list of tools: these tools are basically Python functions which you can call with code.

You have the ability to execute code in a Python environment. To execute code, you can use response with python code wrapped in an "<execution-code>" xml tag. 
The code will be executed inside the Python environment, and whatever you print into the console will be returned to you.
Your code is running inside an async environment, so you can use async/await syntax.
You can only include ONE <execution-code> block per response, do not include more than one <execution-code> block in your response.

Use this python environment to accomplish the task you are given, be proactive and use the function available to you but ask for help if you feel stuck on a task.
Do not ask permission or notify the user you plan on executing code, just do it.

Example:
<execution-code>
import time
import random

print("Hello, world!")
time.sleep(2)
print("Random number:", random.randint(1, 100))

result = await some_async_function({"field": "value"});
print(result)
</execution-code>

You are not allowed to execute any code that is not wrapped in the <execution-code> tag, it will be ignored.
ONLY use the <execution-code> tag to execute code when needed, do not use it for any other purpose.

`


function getFunctions(tool: AgentTool) {
    let outParameter = tool.outSchema ? JSON.stringify(zodToJsonSchema(tool.outSchema)) : "ToolResponse";
    const toolDefinition = `
- FunctionName: ${tool.name}
- Async Function: true (must be awaited)
- Description: ${tool.description}
- Input Parameter:\n${JSON.stringify(zodToJsonSchema(tool.schema))}
- Function Output:\n${outParameter}
`
    return toolDefinition;
}

export const getFunctionsPrompt = (tool: AgentTool[]) => {
    if (tool.length === 0) {
        return "";
    }

    let functions = tool.map((tool) => getFunctions(tool)).join("\n------\n");
    return `\nThe python environment has the following functions available to it, use them to accomplish the requested goal from the user.
The result of functions with an output parameter of "ToolResponse" can be printed with the "print" function, and the result will be returned to you.
If the function has a different defined output type then its output can be used in other functions as an normal Python type.
The parameters of this functions is a single Dictionary parameter, not a list of parameters. Example: await functionName({"param1": "value1", "param2": "value2"}).
All functions are async and must be awaited.
FUNCTION LIST:\n${functions}\n\n---------------------------------\n`;

}

export const PYTHON_SCRIPT_EXAMPLE = `
<execution-code>
...PYTHON CODE HERE...
</execution-code>
`