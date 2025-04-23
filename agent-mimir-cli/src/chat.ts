import chalk from 'chalk';
import readline from 'readline';
import path from "path";
import { extractAllTextFromComplexResponse } from "agent-mimir/utils/format";
import { MultiAgentCommunicationOrchestrator, HandleMessageResult, IntermediateAgentResponse } from "agent-mimir/communication/multi-agent";
import { InputAgentMessage } from 'agent-mimir/agent';

export type FunctionResponseCallBack = (toolCalls: {
  agentName: string,
  id?: string;
  name: string;
  response: string;
}) => Promise<void>;

const messageDivider = chalk.yellow("---------------------------------------------------\n");

export async function chatWithAgent(agentManager: MultiAgentCommunicationOrchestrator, continousMode: boolean) {

  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("Available commands:\n")
  console.log("/reset - resets all agents\n\n");

  async function sendResponse(agentName: string, message: string, attachments?: string[]) {
    const agentNameMessage = `${chalk.magenta("Agent:")} ${chalk.red(agentName)}\n`;
    const providedFiles = attachments?.map((f: any) => f.fileName).join(", ") || "None";
    const filesMessage = (attachments?.length ?? 0) > 0 ? `\nFiles provided by AI: ${providedFiles}\n` : "";
    const responseMessage = `${messageDivider}${agentNameMessage}\n${filesMessage}${message}`;
    console.log(responseMessage)
  }

  let intermediateResponseHandler = async (chainResponse: IntermediateAgentResponse) => {
    if (chainResponse.type === "toolResponse") {
      const formattedResponse = extractAllTextFromComplexResponse(chainResponse.response).substring(0, 3000);
      const toolResponse = `${chalk.greenBright("Called tool:")} ${chalk.red(chainResponse.name)} \n${chalk.greenBright("Id:")} ${chalk.red(chainResponse.id ?? "N/A")} \n${chalk.greenBright("Responded with:")}\n${formattedResponse}`;
      await sendResponse(chainResponse.agentName, toolResponse);

    } else {
      const stringResponse = extractAllTextFromComplexResponse(chainResponse.content.content);
      const discordMessage = `${chalk.greenBright("Sending message to:")} ${chalk.red(chainResponse.destinationAgent)}\n${stringResponse}`;
      await sendResponse(chainResponse.sourceAgent, discordMessage, chainResponse.content.sharedFiles?.map((f: any) => f.url));
    }
  };

  topLoop: while (true) {

    let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
      rl.question((messageDivider + chalk.blue("Human: ")), (answer) => {
        resolve({ message: answer });
      });
    })]);

    const parsedMessage = extractContentAndText(answers.message);
    if (parsedMessage.type === "command") {
      await handleCommands(parsedMessage.command!, agentManager);
      continue topLoop;
    }
    let result: IteratorResult<IntermediateAgentResponse, HandleMessageResult>;
    let generator = agentManager.handleMessage((agent) => agent.call({
      threadId: "1",
      message: parsedMessage.message,
    }));
    while (!(result = await generator.next()).done) {
      intermediateResponseHandler(result.value);
    }


    if (result.value.type === "toolRequest") {
      do {
        const toolCalls = (result.value.toolCalls ?? []).map(tr => {
          return `${chalk.greenBright("Tool request: ")}${chalk.red(tr.toolName)} \n${chalk.greenBright("Id: ")}${chalk.red(tr.id ?? "N/A")} \n${chalk.greenBright("With Payload: ")}\n${JSON.stringify(tr.input)}`;
        }).join("\n");
        sendResponse(result.value.callingAgent, toolCalls);

        if (continousMode) {
          generator = agentManager.handleMessage((agent) => agent.call({
            threadId: "1",
            message: null,
          }));
        } else {
          let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
            rl.question((chalk.blue("Should AI Continue? Type Y or click Enter to continue, otherwise type a message to the AI: ")), (answer) => {
              resolve({ message: answer });
            });
          })]);

          if (answers.message.toLowerCase() === "y" || answers.message === "") {
            generator = agentManager.handleMessage((agent) => agent.call({
              threadId: "1",
              message: null,
            }));
          } else {
            const parsedMessage = extractContentAndText(answers.message);
            if (parsedMessage.type === "command") {
              await handleCommands(parsedMessage.command!, agentManager);
              continue topLoop;
            }
            generator = agentManager.handleMessage((agent) => agent.call({
              threadId: "1",
              message: parsedMessage.message
            }));
          }
        }

        while (!(result = await generator.next()).done) {
          intermediateResponseHandler(result.value);
        }

      } while (result.value.type === "toolRequest");
    }

    const stringResponse = extractAllTextFromComplexResponse(result.value.content.content);
    sendResponse(agentManager.currentAgent.name, stringResponse, result.value.content.sharedFiles?.map((f: any) => f.url));
  }
}

async function handleCommands(command: string, agentManager: MultiAgentCommunicationOrchestrator) {
  if (command.trim() === "reset") {
    await agentManager.reset({threadId: "1"});
    console.log(chalk.red(`Agents have been reset.`));
  } else {
    console.log(chalk.red(`Unknown command: ${command}`));
  }
}

function extractContentAndText(str: string): {
  type: `command`,
  command: string,
} | {
  type: `message`,
  message: InputAgentMessage
} {
  if (str.startsWith("/")) {
    return {
      type: 'command',
      command: str.slice(1)
    }
  }
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
      sharedFiles: [],
      content: [
        {
          type: "text",
          text: remainingText.trim()
        }
      ],
    }
  };

}

