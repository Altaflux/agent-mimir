import { MessagesPlaceholder, SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { MimirAgentPlugin, MimirPluginFactory, PluginContext } from "../schema.js";

export class TimePluginFactory implements MimirPluginFactory {

    name: string = "time";

    create(context: PluginContext): MimirAgentPlugin {
        return new TimePlugin();
    }

}

class TimePlugin extends MimirAgentPlugin {

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
