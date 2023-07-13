
export const FORMAT_INSTRUCTIONS = `RESPONSE FORMAT INSTRUCTIONS
----------------------------

When responding to me please, please output a response in the following format:
--------------------
-Thoughts: string \\ Any observation or thought about the task
-Reasoning: string \\ Reasoning for the command
-Plan: \\ An JSON array of strings representing the text of the plan of pending tasks needed to complete the user's request. This field is obligatory but can be empty.
-Current Plan Step: string \\ The step currently being worked on.
-Goal Given By User: string \\ What is the main goal the user has tasked you with. If the user has made a change in your task then please update this field to reflect the change.
-Save To ScratchPad: string, \\ Any important piece of information you may be able to use later. This field is optional. 
-Command: string \\ The command to run. This field is obligatory. Must be one of {tool_names}
-Command JSON: \\Command JSON goes here, the input to the command. This field is obligatory.



Example Response:
--------------------
-Thoughts: I can come up with an innovative solution to this problem.
-Reasoning: I have introduced an unexpected twist, and now I need to continue with the plan.
-Plan: ["Think of a better solution to the problem", "Ask the user for his opinion on the solution", "Work on the solution", "Present the answer to the user"]
-Current Plan Step: "Think of a better solution to the problem"
-Goal Given By User: Find a solution to the problem.
-Save To ScratchPad: The plot of the story is about a young kid going on an adventure to find his lost dog.
-Command: someCommand
-Command JSON:
The input value of a the command

`;


export const FORMAT_INSTRUCTIONS_WITHOUT_COMMAND = `RESPONSE FORMAT INSTRUCTIONS
----------------------------

When responding to me please, please output a response in the following format:
--------------------
-Thoughts: string \\ Any observation or thought about the task.
-Reasoning: string \\ Reasoning for the decision you are making.
-Plan: \\ An JSON array of strings representing the text of the plan of pending tasks needed to complete the user's request. This field is obligatory but can be empty.
-Current Plan Step: string \\ The step currently being worked on.
-Goal Given By User: string \\ What is the main goal the user has tasked you with. If the user has made a change in your task then please update this field to reflect the change.
-Save To ScratchPad: string, \\ Any important piece of information you may be able to use later. This field is optional. 
-Message To User: string, \\ Any message you want to send to the user. Useful when you want to present the answer to the request. Use it when you think that you are stuck or want to present the anwser to the user. This field must not be set at the same time as calling a function.



Example Response:
--------------------
-Thoughts: I can come up with an innovative solution to this problem.
-Reasoning: I have introduced an unexpected twist, and now I need to continue with the plan.
-Plan: ["Think of a better solution to the problem", "Ask the user for his opinion on the solution", "Work on the solution", "Present the answer to the user"]
-Current Plan Step: "Think of a better solution to the problem"
-Goal Given By User: Find a solution to the problem.
-Save To ScratchPad: The plot of the story is about a young kid going on an adventure to find his lost dog.
`;