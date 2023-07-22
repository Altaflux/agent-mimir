import { ChainValues } from "langchain/schema";

import chalk from 'chalk';
import { Agent } from "agent-mimir/schema";
import readline from 'readline';


export async function chatWithAgent(continuousMode: boolean, assistant: Agent) {
  const executor = assistant.agent!;
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let aiResponse: undefined | ChainValues = undefined;
  while (true) {
    if (aiResponse && aiResponse.toolStep) {

      let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
        rl.question((chalk.blue("Should AI Continue? Type Y or click Enter to continue, otherwise type a message to the AI: ")), (answer) => {
          resolve({ message: answer });
        });
      })]);

      if (answers.message.toLowerCase() === "y" || answers.message === "") {
        aiResponse = (await executor.call({ continuousMode, continue: true }))
      } else {
        aiResponse = (await executor.call({ continuousMode, input: answers.message }))
      }
    } else {

      let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
        rl.question((chalk.blue("Human: ")), (answer) => {
          resolve({ message: answer });
        });
      })]);

      aiResponse = (await executor.call({ continuousMode, input: answers.message }))
    }
    console.log(chalk.red("AI Response: ", chalk.blue(aiResponse?.output)));
  }
}

