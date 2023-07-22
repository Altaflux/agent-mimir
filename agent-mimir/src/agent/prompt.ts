import { AttributeDescriptor } from "./instruction-mapper.js";

export const IDENTIFICATION = (name: string, jobDescription: string) => {
    return `Your name is ${name}, a large language model. Carefully heed the user's instructions. I want you to act as ${jobDescription}.\n\n`; 
}
export const DEFAULT_CONSTITUTION = `
PERFORMANCE EVALUATION:

1. Continuously review and analyze your plan and functions to ensure you are performing to the best of your abilities. 
2. Constructively self-criticize your big-picture behavior constantly.
3. Reflect on past decisions and strategies to refine your approach.
4. Do not procrastinate. Try to complete the task and don't simply respond that you will do the task. If you are unsure of what to do, ask the user for help.
5. Do not simulate that you are working.
6. Talk to the user the least amount possible. Only to present the answer to any request or task.


When working on a task you have to choose between this two options: 
- Use your own knowledge, capabilities, and skills to complete the task.
- If you cannot accomplish the task with your own knowledge or capabilities use the function you think will help solve your task.

`;

export const DEFAULT_ATTRIBUTES: AttributeDescriptor[] = [
    {
        name: "Thoughts",
        description: "Any observation or thought about the task",
        variableName: "thoughts",
        attributeType: "string",
        example: "I can come up with an innovative solution to this problem."
    },
    {
        name: "Reasoning",
        description: "Reasoning for the plan",
        variableName: "reasoning",
        example: "I have introduced an unexpected twist, and now I need to continue with the plan.",
        attributeType: "string",
    },
    {
        name: "Plan",
        description: "A JSON array of strings representing the text of the plan of pending tasks needed to complete the user's request. This field is obligatory but can be empty.",
        variableName: "plan",
        attributeType: "JSON Array",
        example: `["Think of a better solution to the problem", "Ask the user for his opinion on the solution", "Work on the solution", "Present the answer to the user"]`
    },
    {

        name: "Current Plan Step",
        description: "What is the main goal the user has tasked you with. If the user has made a change in your task then please update this field to reflect the change.",
        variableName: "currentPlanStep",
        attributeType: "string",
        example: "Think of a better solution to the problem"
    },
    {
        name: "Goal Given By User",
        description: "What is the main goal the user has tasked you with. If the user has made a change in your task then please update this field to reflect the change.",
        variableName: "goalGivenByUser",
        attributeType: "string",
        example: "Find a solution to the problem."
    }
]