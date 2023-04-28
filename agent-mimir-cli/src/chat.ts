import { ChainValues } from "langchain/schema";

import inquirer from "inquirer";
import chalk from 'chalk';
import { Helper } from "agent-mimir";

export async function chatWithAssistant(assistant: Helper) {
    const executor = assistant.agent!;
    let aiResponse: undefined | ChainValues = undefined;
    while (true) {
      if (aiResponse && aiResponse.toolStep) {
        const questions = [
          {
            type: 'input',
            name: 'message',
            message: "Should AI Continue? Type Y or click Enter to continue, otherwise type a message to the AI: ",
          },
        ];
        aiResponse = await (inquirer).prompt(questions).then((answers: any) => {
          if (answers.message.toLowerCase() === "y" || answers.message==="") {
            return executor.call({ continue: true })
          }
          return executor.call({ input: answers.message })
        }).then((result) => {
          return result;
        });
      } else {
        const questions = [
          {
            type: 'input',
            name: 'message',
            message: "Human: ",
  
          },
        ];
        aiResponse = await (inquirer).prompt(questions).then((answers: any) => {
          return executor.call({ input: answers.message })
        }).then((result) => {
          return result;
        });
  
      }
   
      console.log(chalk.red("AI Response: ", chalk.blue(aiResponse!.output)));
  
  
    }
}