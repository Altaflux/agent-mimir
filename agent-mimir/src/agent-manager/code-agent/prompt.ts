
import { isZodSchemaV3, isZodSchemaV4 } from "@langchain/core/utils/types";
import { AgentTool } from "../../tools/index.js";
import { toPythonFunctionName } from "./utils.js";
import { z } from "zod/v4";
import { zodToJsonSchema } from "zod-to-json-schema";

export function functionPrompt(workspaceDirectory: string): string {
    return `

You have the ability to execute code in a Python environment. To execute code, you can respond with a python code block wrapped in an "<execution-code>" xml tag. 
The code will be executed inside the Python environment, and whatever you print into the console will be returned to you.
You can install pip libraries by defining them comma separated in an <pip-dependencies-to-install> xml block.
Do not assume the success of the execution of the script until you have verified its output.

You have access to a Python execution environment. You may execute Python ONLY by placing raw Python code inside the <execution-code> element described below. Any code outside <execution-code> will NOT be executed.
IMPORTANT STRUCTURE RULES
- If present, <execution-code> MUST be a direct child of <response-metadata>.
- Do NOT place <execution-code> anywhere else (never outside <response-metadata>).
- Do NOT output more than one <response-metadata>.
- Do NOT output more than one <execution-code>.
- Do NOT output more than one <pip-dependencies-to-install>.
- You may execute Python ONLY by placing RAW Python source code inside <execution-code>.
  Any code outside <execution-code> will NOT be executed.
- Do NOT include Markdown code fences (e.g., \`\`\`python) inside <execution-code>.
- Do not ask permission or announce that you will execute code; just do it when needed.
- Do not output <execution-code> until you have clarified with the user any questions you have about his request.
- Do not assume success—verify by inspecting printed output from your code.
- The user cannot see execution output; summarize any needed results in Part B.
- Execute all the code inside that single <execution-code>. 
- The script inside <execution-code> must be wrapped in CDATA.

Python Environment Rules:
- Use this python environment to accomplish the task you are given, be proactive and use the functions available to you but ask for help if you feel stuck on a task.
- You must not ask permission or notify the user you plan on executing code, just do it.
- You have been given access to a list of tools: these tools are Python functions which you can call with code.
- The user cannot see the the result of the code being executed, any information you want to share with the user must responded back to them in a normal message.
- The workspace directory is mounted at "${workspaceDirectory}" and is the current working directory of the script.
- The functions that return ToolResponse are not a JSON or Dictionary type, your best course of action is to always print() them to view the content of the returned value.

Example:
<pip-dependencies-to-install>requests,pymysql,openpyxl</pip-dependencies-to-install>
<execution-code>
<![CDATA[
import time
import random

print("Hello, world!")
time.sleep(2)
print("Random number:", random.randint(1, 100))

result = some_function({"field": "value"});
print(result)
]]>
</execution-code>


`
}


function getFunctions(tool: AgentTool) {
    const outParameter = tool.outSchema === undefined ? "ToolResponse"
        : isZodSchemaV4(tool.outSchema) ? JSON.stringify(z.toJSONSchema(tool.outSchema))
            : isZodSchemaV3(tool.outSchema) ? JSON.stringify(zodToJsonSchema(tool.outSchema))
                : JSON.stringify(tool.outSchema);
    const schema = isZodSchemaV4(tool.schema) ? z.toJSONSchema(tool.schema) : isZodSchemaV3(tool.schema) ? zodToJsonSchema(tool.schema) : tool.schema;
    const toolDefinition = `
- FunctionName: ${toPythonFunctionName(tool.name)}
- Description: ${tool.description}
- Input Parameter: ${JSON.stringify(schema)}
- Function Output: ${outParameter}
`
    return toolDefinition;
}


export const getFunctionsPrompt = (dependencies: string[], tool: AgentTool[]) => {
    if (tool.length === 0) {
        return "";
    }
    let functionList = [...tool.map((tool) => getFunctions(tool))]
    let functions = functionList.join("\n------\n");
    return `\nThe python environment has the following global functions available for to use, use them to accomplish the requested goal from the user.
The result of functions with an output parameter of "ToolResponse" can be printed with the "print" function, and the result will be returned to you.
If the function has a different defined output type then its output can be used in other functions as an normal Python type.
The parameters of this functions is a single Dictionary parameter, not a list of parameters. Example: functionName({"param1": "value1", "param2": "value2"}).
FUNCTIONS LIST:\n${functions}\n\n---------------------------------\n
${dependencies.length > 0 ? `The following libraries are available in the Python environment: ${dependencies.join(", ")}` : ""}
\n---------------------------------\n
`
        ;

}

export const PYTHON_SCRIPT_SCHEMA = `
<xs:element name="pip-dependencies-to-install" type="xs:string" minOccurs="0" maxOccurs="1">
    <xs:annotation>
        <xs:documentation xml:lang="en">
            A list of comma separated PIP libraries to be installed into the Python environment. By default the python environment only comes with the standard libraries of Python.
            Any other dependency you may need to execute your script must be declared here so it becomes available for usage.
            You can only include ONE <pip-dependencies-to-install> block per response, do not include more than one <pip-dependencies-to-install> block in your response.
        </xs:documentation>
    </xs:annotation>
</xs:element>
<xs:element name="execution-code" type="xs:string" minOccurs="0" maxOccurs="1">
    <xs:annotation>
        <xs:documentation xml:lang="en">
            Python code to be executed in the Python environment. The code must be wrapped in this tag.
            You can only include ONE <execution-code> block per response, do not include more than one <execution-code> block in your response.
            Only use the <execution-code> tag to execute code when needed, do not use it for any other purpose.
        </xs:documentation>
    </xs:annotation>
</xs:element>

`
