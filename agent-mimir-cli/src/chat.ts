import { ChainValues } from "langchain/schema";

import chalk from 'chalk';
import { Agent, AgentUserMessage, FILES_TO_SEND_FIELD } from "agent-mimir/schema";
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
        aiResponse = await Retry(() => executor.call({ continuousMode, input: parsedMessage.text, [FILES_TO_SEND_FIELD]: files }));
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
      aiResponse = await Retry(() => executor.call({ continuousMode, input: parsedMessage.text, [FILES_TO_SEND_FIELD]: files }));
    }
    if (aiResponse?.toolStep) {
      const response: { toolName: string, toolArguments: string } = JSON.parse(aiResponse?.output);
      const responseMessage = `Agent is requesting permission to use tool: "${response.toolName}" with input:\n"${response.toolArguments}"`
      console.log(chalk.red("AI Response: ", chalk.blue(responseMessage)));

    } else {
      const response: AgentUserMessage = JSON.parse(aiResponse?.output);
      const responseMessage = `Files provided by AI: ${response.sharedFiles?.map(f => f.fileName).join(", ") || "None"}\n\n${response.message}`;
      console.log(chalk.red("AI Response: ", chalk.blue(responseMessage)));
    }

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