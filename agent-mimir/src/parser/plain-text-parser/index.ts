
import { AIChatMessage, BaseChatMessage, StoredMessage } from "langchain/schema";
import { AIMessageSerializer, AIMessageType } from "../../schema.js";
import { FORMAT_INSTRUCTIONS } from "./prompt.js";
import { MimirAIMessage } from "../../agent/function/index.js";
import { mapStoredMessagesToChatMessages } from "../../utils/format.js";

const responseParts = [
    "-Reasoning",
    "-Plan",
    "-Command JSON",
    "-Command",
    "-Save To ScratchPad",
    "-Current Plan Step",
    "-Thoughts",
    "-Goal Given By User",
    "-Message To User"
].join('|');


function regexBuilder(field: string) {
    return new RegExp(`(?<=-${field}:\\s)([\\s\\S]*?)` + '(?=\\s' + responseParts + "|$)");
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
    messageToUser: regexBuilder('Message To User')
}

export class PlainTextMessageSerializer extends AIMessageSerializer {

    getFormatInstructions(): string {
        return FORMAT_INSTRUCTIONS;
    }

    lc_namespace = ["langchain", "output_parsers"]

    async serialize(message: AIMessageType): Promise<string> {
        const result = `-Thoughts: ${message.thoughts ?? ""}
-Reasoning: ${message.reasoning ?? ""}
-Plan: ${message.plan ? JSON.stringify(message.plan) : ""}
-Current Plan Step: ${message.currentPlanStep ?? ""}
-Save To ScratchPad: ${message.saveToScratchPad ?? ""}
-Goal Given By User: ${message.mainGoal ?? ""}
-Command: ${message.action ?? ""}
-Command JSON: ${message.action_input ? JSON.stringify(message.action_input) : ""}
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
        const messageToUser = regexParser.messageToUser.exec(text)?.[0]?.trim();
        const result: AIMessageType = {
            thoughts: thoughts,
            reasoning: reasoning,
            plan: plan ? JSON.parse(plan) : undefined,
            action: command!,
            action_input: commandText ? JSON.parse(commandText!) : {},
            saveToScratchPad: saveToScratchPad,
            currentPlanStep: currentPlanStep,
            mainGoal: mainGoal,
            messageToUser: messageToUser
        }
        return result;
    }

}

export async function deserializeWithFunction(text: string, functionName: string, args: string): Promise<AIMessageType> {
    const message = await new PlainTextMessageSerializer().deserialize(text);
    message.action = functionName;
    message.action_input = args ? JSON.parse(args) : undefined;
    return message;
}

export abstract class HumanMessageSerializer {
    abstract serialize(message: BaseChatMessage): Promise<string>;
    async deserialize(text: string): Promise<BaseChatMessage > {
        const message = JSON.parse(text) as StoredMessage;
        const chatMessage = mapStoredMessagesToChatMessages([message])[0];
        return chatMessage;
    };
}

export class HumanMessageSerializerImp extends HumanMessageSerializer {
    async serialize(message: BaseChatMessage): Promise<string> {
        const serializedMessage = message.toJSON();
        return JSON.stringify(serializedMessage);
    }
}

export abstract class AiMessageSerializer {
    abstract serialize(message: any): Promise<string>;

    async deserialize(message: string): Promise<BaseChatMessage> {
        const storedMessage = JSON.parse(message) as StoredMessage;
        const chatMessage = mapStoredMessagesToChatMessages([storedMessage])[0];
        return chatMessage;
    };
}

export class FunctionCallAiMessageSerializer extends AiMessageSerializer {

    async serialize(aiMessage: any): Promise<string> {
        const output = aiMessage;
        const functionCall = output.functionCall?.name ? {
            function_call: {
                name: output.functionCall?.name,
                arguments: (output.functionCall?.arguments)
            },
        } : {};
        const message = new AIChatMessage(output.text ?? "", {
            ...functionCall
        });
        const serializedMessage = message.toJSON();
        return JSON.stringify(serializedMessage);
    }
}