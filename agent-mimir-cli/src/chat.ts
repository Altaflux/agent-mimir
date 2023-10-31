import chalk from 'chalk';
import { Agent, AgentResponse, AgentUserMessage, FILES_TO_SEND_FIELD } from "agent-mimir/schema";
import readline from 'readline';
import { Retry } from "./utils.js";
import path from "path";
import { AgentManager } from 'agent-mimir/agent-manager';


export async function chatWithAgent(continuousMode: boolean, assistant: Agent, agentManager: AgentManager) {
  const agentStack: Agent[] = [];
  let pendingMessage: PendingMessage | null = null;
  let executor = assistant!;
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let aiResponse: undefined | AgentResponse = undefined;
  console.log("Available commands:\n")
  console.log("/reset - resets all agents\n\n")
  while (true) {
    if (aiResponse && aiResponse.toolStep()) {

      let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
        rl.question((chalk.blue("Should AI Continue? Type Y or click Enter to continue, otherwise type a message to the AI: ")), (answer) => {
          resolve({ message: answer });
        });
      })]);

      if (answers.message.toLowerCase() === "y" || answers.message === "") {
        aiResponse = await Retry(() => executor.call(continuousMode, { continue: true }));
      } else {
        const parsedMessage = extractContentAndText(answers.message);
        if (parsedMessage.type === "command") {
          await handleCommands(parsedMessage.command!, assistant, agentManager);
          continue;
        }
        const files = parsedMessage.message?.responseFiles.map((file) => {
          const filename = path.basename(file);
          return { fileName: filename, url: file };
        });
        aiResponse = await Retry(() => executor.call(continuousMode, { input: parsedMessage.message?.text, [FILES_TO_SEND_FIELD]: files }));
      }
    } else {

      let messageToAgent: PendingMessage | undefined = undefined;
      if (pendingMessage) {
        messageToAgent = pendingMessage;
        pendingMessage = null;
      } else {
        let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
          rl.question((chalk.blue("Human: ")), (answer) => {
            resolve({ message: answer });
          });
        })]);

        const parsedMessage = extractContentAndText(answers.message);
        if (parsedMessage.type === "command") {
          await handleCommands(parsedMessage.command!, assistant, agentManager);
          continue;
        }
        messageToAgent = {
          message: parsedMessage.message?.text!,
          sharedFiles: parsedMessage.message?.responseFiles.map((file) => {
            const filename = path.basename(file);
            return { fileName: filename, url: file };
          })
        };
      }


      aiResponse = await Retry(() => executor.call(continuousMode, { input: messageToAgent!.message, [FILES_TO_SEND_FIELD]: messageToAgent?.sharedFiles ?? [] }));
    }
    if (aiResponse?.toolStep()) {
      const response = aiResponse?.output;
      const responseMessage = `Agent: "${executor.name}" is requesting permission to use tool: "${response.toolName}" with input:\n"${response.toolArguments}"`
      console.log(chalk.red("AI Response: ", chalk.blue(responseMessage)));

    } else if (aiResponse?.agentResponse()) {
      const response: AgentUserMessage = aiResponse?.output;
      if (response.agentName) {
        agentStack.push(executor);
        executor = agentManager.getAgent(response.agentName)!;
        pendingMessage = response;
      } else {
        if (agentStack.length === 0) {
          const responseMessage = `Files provided by AI: ${response.sharedFiles?.map(f => f.fileName).join(", ") || "None"}\n\n${response.message}`;
          console.log(chalk.red("AI Response: ", chalk.blue(responseMessage)));
        } else {
          pendingMessage = {
            message: `${executor.name} responded with: ${response.message}`,
            sharedFiles: response.sharedFiles
          };
          executor = agentStack.pop()!;
        }
      }

    }
  }
}

async function handleCommands(command: string, assistant: Agent, agentManager: AgentManager) {
  if (command.trim() === "reset") {
    for (const agent of agentManager.getAllAgents()) {
      await agent.reset();
    }
    console.log(chalk.red(`Agents have been reset.`));
  } else {
    console.log(chalk.red(`Unknown command: ${command}`));
  }
}

type PendingMessage = {
  sharedFiles?: {
    url: string;
    fileName: string;
  }[],
  message: string;
}

function extractContentAndText(str: string): {
  type: `command` | `message`,
  command?: string,
  message?: {
    responseFiles: string[];
    text: string;
  }
} {

  if (str.startsWith("/")) {
    return {
      type: 'command',
      command: str.slice(1)
    }
  }

  const regex = /^(?:\s*\(([^)]+)\)\s*)+/g;
  let matches = [];
  let match;

  while ((match = regex.exec(str)) !== null) {
    matches.push(match[1]);
  }

  // Get the unmatched portion of the string after the parentheses
  const remainingText = str.replace(regex, '');

  return {
    type: 'message',
    message: {
      responseFiles: matches,
      text: remainingText.trim()
    }
  };
}