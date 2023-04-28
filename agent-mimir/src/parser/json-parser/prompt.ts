
export const FORMAT_INSTRUCTIONS = `RESPONSE FORMAT INSTRUCTIONS
----------------------------

When responding to me please, please output a response in the following format:
--------------------
-Thoughts: string \\ Any observation or thought about the task
-Reasoning: string \\ Reasoning for the command
-Plan: \\ An JSON array of strings representing the text of the plan of pending tasks needed to complete the user's request. This field is obligatory but can be empty.
-Current Plan Step: string \\ The step currently being worked on.
-Save To ScratchPad: string, \\ Any important piece of information you may be able to use later. This field is optional. 
-Command: string \\ The command to run. This field is obligatory. Must be one of {tool_names}
-Command Text: \\Command text goes here, the input to the command. This field is obligatory.



Example Response:
--------------------
-Thoughts: I can come up with an innovative solution to this problem.
-Reasoning: I have introduced an unexpected twist, and now I need to continue with the plan.
-Plan: ["Think of a better solution to the problem", "Ask the user for his opinion on the solution", "Work on the solution", "Present the answer to the user"]
-Current Plan Step: "Think of a better solution to the problem"
-Save To ScratchPad: The plot of the story is about a young kid going on an adventure to find his lost dog.
-Command: someCommand
-Command Text:
The input value of a the command

`;