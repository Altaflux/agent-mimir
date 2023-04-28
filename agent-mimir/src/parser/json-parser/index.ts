
import { AIMessageSerializer, AIMessageType } from "../../schema.js";
import { simpleParseJson } from "../../utils/json.js";
import { FORMAT_INSTRUCTIONS } from "./prompt.js";


export class JsonMessageSerializer extends AIMessageSerializer {

  getFormatInstructions(): string {
    return FORMAT_INSTRUCTIONS;
  }

  async serialize(output: AIMessageType): Promise<string> {
    const formattedOutput = output;
    const correctedOuputFormat = {
      "thoughts": formattedOutput.thoughts,
      "reasoning": formattedOutput.reasoning,
      "currentPlanStep": formattedOutput.currentPlanStep,
      "plan": formattedOutput.plan,
      "saveToScratchPad": formattedOutput.saveToScratchPad,
      "command": formattedOutput.action,
      "command_text": formattedOutput.action_input,
    };
    return `\`\`\`json\n${JSON.stringify(correctedOuputFormat, null, 2)}\n\`\`\``;
  }
  async deserialize(text: string): Promise<AIMessageType> {
    return await parseAIMessage(text);
  }

}


async function parseAIMessage(input: string): Promise<AIMessageType> {


  let response = undefined;
  try {
    response = await simpleParseJson(input);
  } catch (e: any) {
    return {
      action: "PARSING_ERROR",
      action_input: "Failed to parse JSON: " + `${input}`,
    }
  }

  if (!response.command || !response.command_text) {
    return {
      action: "PARSING_ERROR",
      action_input: "Missing command or command_text:" + `${input}`,
    }
  }
  if (typeof response.command_text === "object") {
    response.command_text = JSON.stringify(response.command_text);
  }

  return {
    thoughts: response.thoughts,
    reasoning: response.reasoning,
    saveToScratchPad: response.saveToScratchPad,
    currentPlanStep: response.currentPlanStep,
    action: response.command,
    action_input: response.command_text,
    plan: response.plan,
  };

}
