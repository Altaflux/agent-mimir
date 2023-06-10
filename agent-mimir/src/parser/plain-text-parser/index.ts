
import { AIMessageSerializer, AIMessageType } from "../../schema.js";
import { FORMAT_INSTRUCTIONS } from "./prompt.js";

const responseParts = [
    "-Reasoning",
    "-Plan",
    "-Command JSON",
    "-Command",
    "-Save To ScratchPad",
    "-Current Plan Step",
    "-Thoughts",
    "-Goal Given By User",
].join('|');


function regexBuilder(field: string) {
    return new RegExp(`(?<=-${field}:\\s)([\\s\\S]*?)` + '(?=\\s' + responseParts +  "|$)");
}
const regexParser = {
    thougths: regexBuilder('Thoughts'),
    reasoning: regexBuilder('Reasoning'),
    plan: regexBuilder('Plan'),
    command: regexBuilder('Command'),
    commandText: regexBuilder('Command JSON'),
    saveToScratchPad: regexBuilder('Save To ScratchPad'),
    currentPlanStep: regexBuilder('Current Plan Step'),
    mainGoal: regexBuilder('Goal Given By User'),
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
-Goal Given By User: ${message.mainGoal ?? ""}
-Command: ${message.action ?? ""}
-Command JSON: ${JSON.stringify(message.action_input) ?? ""}
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
        const mainGoal = regexParser.mainGoal.exec(text)?.[0]?.trim();
        const result: AIMessageType = {
            thoughts: thoughts,
            reasoning: reasoning,
            plan: plan ? JSON.parse(plan) : undefined,
            action: command!,
            action_input: JSON.parse(commandText!),
            saveToScratchPad: saveToScratchPad,
            currentPlanStep: currentPlanStep,
            mainGoal: mainGoal,
        }
        return result;
    }

}