import chalk from 'chalk';
import readline from 'readline';
import path from "path";
import { extractAllTextFromComplexResponse } from "agent-mimir/utils/format";
import { MultiAgentCommunicationOrchestrator, HandleMessageResult, IntermediateAgentResponse } from "agent-mimir/communication/multi-agent";
import { InputAgentMessage } from 'agent-mimir/agent';

export type FunctionResponseCallBack = (toolCalls: {
  agentName: string,
  name: string;
  response: string;
}) => Promise<void>;


export async function chatWithAgent(agentManager: MultiAgentCommunicationOrchestrator) {

  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("Available commands:\n")
  console.log("/reset - resets all agents\n\n");

  async function sendResponse(message: string, attachments?: string[]) {
    const responseMessage = `Files provided by AI: ${attachments?.map((f: any) => f.fileName).join(", ") || "None"}\n\n${message}`;
    console.log(responseMessage)
  }

  let toolCallback: FunctionResponseCallBack = async (call) => {
    const toolResponse = `Agent: \`${call.agentName}\`  \n---\nCalled function: \`${call.name}\` \nResponded with: \n\`\`\`${call.response.substring(0, 3000)}\`\`\``;
    await sendResponse(toolResponse);
  };

  let intermediateResponseHandler = async (chainResponse: IntermediateAgentResponse) => {
    if (chainResponse.type === "toolResponse") {
      toolCallback({
        agentName: chainResponse.agentName,
        name: chainResponse.name,
        response: chainResponse.response
      });
    } else {
      const stringResponse = extractAllTextFromComplexResponse(chainResponse.content.content);
      const discordMessage = `\`${chainResponse.sourceAgent}\` is sending a message to \`${chainResponse.destinationAgent}\`:\n\`\`\`${stringResponse}\`\`\`` +
        `\nFiles provided: ${chainResponse.content.sharedFiles?.map((f: any) => `\`${f.fileName}\``).join(", ") || "None"}`;
      await sendResponse(discordMessage, chainResponse.content.sharedFiles?.map((f: any) => f.url));
    }
  };

  topLoop: while (true) {

    let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
      rl.question((chalk.blue("Human: ")), (answer) => {
        resolve({ message: answer });
      });
    })]);

    const parsedMessage = extractContentAndText(answers.message);
    if (parsedMessage.type === "command") {
      await handleCommands(parsedMessage.command!, agentManager);
      continue topLoop;
    }
    let result: IteratorResult<IntermediateAgentResponse, HandleMessageResult>;
    let generator = agentManager.handleMessage((agent) => agent.call(parsedMessage.message, {}));
    while (!(result = await generator.next()).done) {
      intermediateResponseHandler(result.value);
    }


    if (result.value.type === "toolRequest") {

      const toolCalls = (result.value.toolCalls ?? []).map(tr => {
        return `Tool request: \`${tr.toolName}\`\n With Payload: \n\`\`\`${JSON.stringify(tr.input)}\`\`\``;
      }).join("\n");
      sendResponse(toolCalls);

      do {
        let answers = await Promise.race([new Promise<{ message: string }>((resolve, reject) => {
          rl.question((chalk.blue("Should AI Continue? Type Y or click Enter to continue, otherwise type a message to the AI: ")), (answer) => {
            resolve({ message: answer });
          });
        })]);



        if (answers.message.toLowerCase() === "y" || answers.message === "") {
          generator = agentManager.handleMessage((agent) => agent.call(null, {}));
        } else {
          const parsedMessage = extractContentAndText(answers.message);
          if (parsedMessage.type === "command") {
            await handleCommands(parsedMessage.command!, agentManager);
            continue topLoop;
          }
          generator = agentManager.handleMessage((agent) => agent.call(parsedMessage.message, {}));
        }


        while (!(result = await generator.next()).done) {
          intermediateResponseHandler(result.value);
        }

      } while (result.value.type === "toolRequest");
    }

    const stringResponse = extractAllTextFromComplexResponse(result.value.content.content);
    sendResponse(stringResponse, result.value.content.sharedFiles?.map((f: any) => f.url));
  }
}

// function userAgentResponseToPendingMessage(msg: AgentUserMessageResponse): PendingMessage {
//   return {
//     message: msg.output.message,
//     sharedFiles: msg.responseAttributes[FILES_TO_SEND_FIELD] ?? []
//   }
// }

async function handleCommands(command: string, agentManager: MultiAgentCommunicationOrchestrator) {
  if (command.trim() === "reset") {
    for (const agent of agentManager.agentManager.values()) {
      await agent.reset();
    }
    console.log(chalk.red(`Agents have been reset.`));
  } else {
    console.log(chalk.red(`Unknown command: ${command}`));
  }
}

type PendingMessage = {
  sharedFiles: {
    url: string;
    fileName: string;
  }[],
  message: string;
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

