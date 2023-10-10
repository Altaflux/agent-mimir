import { ChainValues } from "langchain/schema";

import chalk from 'chalk';
import { Agent } from "agent-mimir/schema";
import readline from 'readline';
import { Retry } from "./utils.js";
import path from "path";


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
        aiResponse = await Retry(() => executor.call({ continuousMode, continue: true }));
      } else {
        const parsedMessage = extractContentAndText(answers.message);
        const files = parsedMessage.content.map((file) => {
          const filename = path.basename(file);
          return { fileName: filename, url: file };
        });
        aiResponse = await Retry(() => executor.call({ continuousMode, input: parsedMessage.text, filesToSend: files }));
      }
    } else {

      let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
        rl.question((chalk.blue("Human: ")), (answer) => {
          resolve({ message: answer });
        });
      })]);

      const parsedMessage = extractContentAndText(answers.message);
      const files = parsedMessage.content.map((file) => {
        const filename = path.basename(file);
        return { fileName: filename, url: file };
      });
      aiResponse = await Retry(() => executor.call({ continuousMode, input: parsedMessage.text, filesToSend: files }));
    }
    console.log(chalk.red("AI Response: ", chalk.blue(aiResponse?.output)));
  }
}

function extractContentAndText(str: string) {
  const regex = /^(?:\s*\(([^)]+)\)\s*)+/g;
  let matches = [];
  let match;

  while ((match = regex.exec(str)) !== null) {
    matches.push(match[1]);
  }

  // Get the unmatched portion of the string after the parentheses
  const remainingText = str.replace(regex, '');

  return {
    content: matches,
    text: remainingText.trim()
  };
}