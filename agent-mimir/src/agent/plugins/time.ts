import { MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { MimirAgentPlugin } from "../../schema.js";


export class TimePlugin extends MimirAgentPlugin {
    
    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(`The current time is: {currentTime}`),
        ];
    }

    async getInputs(): Promise<Record<string, any>> {
        return {
            currentTime: new Date().toISOString(),
        };
    }

}