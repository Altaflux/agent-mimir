
import { zodToJsonSchema } from "zod-to-json-schema";
import { AgentTool } from "../../tools/index.js";
import { toPythonFunctionName } from "./utils.js";
import { z } from "zod";

export const FUNCTION_PROMPT = `

You have the ability to execute code in a Python environment. To execute code, you can respond with a python code block wrapped in an "<execution-code>" xml tag. 
The code will be executed inside the Python environment, and whatever you print into the console will be returned to you.
You can install pip libraries by defining them comma separated in an <libraries-to-install> xml block.

Python Environment Rules:
- You can only include ONE <execution-code> block per response, do not include more than one <execution-code> block in your response.
- Use this python environment to accomplish the task you are given, be proactive and use the function available to you but ask for help if you feel stuck on a task.
- You must not ask permission or notify the user you plan on executing code, just do it.
- You have been given access to a list of tools: these tools are Python functions which you can call with code.
- The user cannot see the the result of the code being executed, any information you want to share with the user must responded back to them in a normal message.

Example:
<libraries-to-install>requests,pymysql,openpyxl</libraries-to-install>
<execution-code>
import time
import random

print("Hello, world!")
time.sleep(2)
print("Random number:", random.randint(1, 100))

result = some_function({"field": "value"});
print(result)
</execution-code>

You are not allowed to execute any code that is not wrapped in the <execution-code> tag, it will be ignored.
ONLY use the <execution-code> tag to execute code when needed, do not use it for any other purpose.

`


function getFunctions(tool: AgentTool) {
    let outParameter = tool.outSchema ? JSON.stringify(zodToJsonSchema(tool.outSchema)) : "ToolResponse";
    const schema = tool.schema instanceof z.ZodSchema ? zodToJsonSchema(tool.schema) : tool.schema;
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
    return `\nThe python environment has the following functions available to it, use them to accomplish the requested goal from the user.
The result of functions with an output parameter of "ToolResponse" can be printed with the "print" function, and the result will be returned to you.
If the function has a different defined output type then its output can be used in other functions as an normal Python type.
The parameters of this functions is a single Dictionary parameter, not a list of parameters. Example: functionName({"param1": "value1", "param2": "value2"}).
FUNCTION LIST:\n${functions}\n\n---------------------------------\n
${dependencies.length > 0 ? `The following libraries are available in the Python environment: ${dependencies.join(", ")}` : ""}
\n---------------------------------\n
`
        ;

}

export const PYTHON_SCRIPT_SCHEMA = `
<xs:element name="libraries-to-install" type="xs:string" minOccurs="0" maxOccurs="1">
    <xsd:annotation>
        <xsd:documentation xml:lang="en">
            A list of comma separated PIP libraries to be installed into the Python environment. By default the python environment only comes with the standard libraries of Python.
            Any other dependency you may need to execute your script must be declared here so it becomes available for usage.
            Python code to be executed in the Python environment. The code must be wrapped in this tag.
            You can only include ONE <libraries-to-install> block per response, do not include more than one <libraries-to-install> block in your response.
        </xsd:documentation>
    </xsd:annotation>
</xs:element>
<xs:element name="execution-code" type="xs:string" minOccurs="0" maxOccurs="1">
    <xsd:annotation>
        <xsd:documentation xml:lang="en">
            Python code to be executed in the Python environment. The code must be wrapped in this tag.
            You can only include ONE <execution-code> block per response, do not include more than one <execution-code> block in your response.
            Only use the <execution-code> tag to execute code when needed, do not use it for any other purpose.
        </xsd:documentation>
    </xsd:annotation>
</xs:element>

`