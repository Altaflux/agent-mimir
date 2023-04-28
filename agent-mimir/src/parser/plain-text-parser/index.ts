
import { AIMessageSerializer, AIMessageType } from "../../schema.js";
import { FORMAT_INSTRUCTIONS } from "./prompt.js";

const regexParser = {
    thougths: new RegExp(/(?<=-Thoughts:\s)([\s\S]*?)(?=\s-Reasoning|-Plan|-Command Text|-Command|-Save To ScratchPad|-Current Plan Step|$)/),
    reasoning: new RegExp(/(?<=-Reasoning:\s)([\s\S]*?)(?=\s-Reasoning|-Plan|-Command Text|-Command|-Save To ScratchPad|-Current Plan Step|$)/),
    plan: new RegExp(/(?<=-Plan:\s)([\s\S]*?)(?=\s-Reasoning|-Plan|-Command Text|-Command|-Save To ScratchPad|-Current Plan Step|$)/),
    command: new RegExp(/(?<=-Command:\s)([\s\S]*?)(?=\s-Reasoning|-Plan|-Command Text|-Command|-Save To ScratchPad|-Current Plan Step|$)/),
    commandText: new RegExp(/(?<=-Command Text:\s)([\s\S]*?)(?=\s-Reasoning|-Plan|-Command Text|-Command|-Save To ScratchPad|-Current Plan Step|$)/),
    saveToScratchPad: new RegExp(/(?<=-Save To ScratchPad:\s)([\s\S]*?)(?=\s-Reasoning|-Plan|-Command Text|-Command|-Save To ScratchPad|-Current Plan Step|$)/),
    currentPlanStep: new RegExp(/(?<=-Current Plan Step:\s)([\s\S]*?)(?=\s-Reasoning|-Plan|-Command Text|-Command|-Save To ScratchPad|-Current Plan Step|$)/),
}

export class PlainTextMessageSerializer extends AIMessageSerializer {

    getFormatInstructions(): string {
        return FORMAT_INSTRUCTIONS;
    }

    async serialize(message: AIMessageType): Promise<string> {
        const result = `-Thoughts: I can come up with an innovative solution to this problem.
-Reasoning: ${message.reasoning ?? ""}
-Plan: ${message.plan ? JSON.stringify(message.plan) : ""}
-Current Plan Step: ${message.currentPlanStep ?? ""}
-Save To ScratchPad: ${message.saveToScratchPad ?? ""}
-Command: ${message.action ?? ""}
-Command Text: ${message.action_input ?? ""}
`
        return result;
    }
    async deserialize(text: string): Promise<AIMessageType> {
        const thoughts = regexParser.thougths.exec(text)?.[0]?.trim();
        const reasoning = regexParser.reasoning.exec(text)?.[0]?.trim();
        const plan = regexParser.plan.exec(text)?.[0]?.trim();
        const command = regexParser.command.exec(text)?.[0]?.trim() ?? "PARSING_ERROR";
        const commandText = regexParser.commandText.exec(text)?.[0]?.trim();
        const saveToScratchPad = regexParser.saveToScratchPad.exec(text)?.[0]?.trim();
        const currentPlanStep = regexParser.currentPlanStep.exec(text)?.[0]?.trim();
        const result: AIMessageType = {
            thoughts: thoughts,
            reasoning: reasoning,
            plan: plan ? JSON.parse(plan) : undefined,
            action: command!,
            action_input: commandText!,
            saveToScratchPad: saveToScratchPad,
            currentPlanStep: currentPlanStep,
        }
        return result;
    }

}