
import { ConversationChain } from "langchain/chains";
import { BaseMemory } from "langchain/memory";
import { ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from "langchain/prompts";
import { InputValues, } from "langchain/schema";
import { Tool } from "langchain/tools";

import { BaseLanguageModel } from "langchain/base_language";

type OutputValues = Record<string, any>;
type MemoryVariables = Record<string, any>;

export class ThinkTool extends Tool {

    public constructor(private memory: BaseMemory, private model: BaseLanguageModel) {
        super();
    }

    protected async _call(arg: string): Promise<string> {
       
        const chatPrompt = ChatPromptTemplate.fromPromptMessages([
            SystemMessagePromptTemplate.fromTemplate("You are ChatGPT, a large language model trained by OpenAI. Carefully heed the user's instructions. Response format is plain english."),
            new MessagesPlaceholder("history"),
            HumanMessagePromptTemplate.fromTemplate(
                "I want you to act as a thinker and brainstormer. You will be given a question from which you will respond with a short and well though idea. Only respond with a single idea. My first question is: {input}"
            ),
        ]);

        const noSaveMemory = new NoSaveMemory(this.memory);
        const chain = new ConversationChain({
            memory: noSaveMemory,
            prompt: chatPrompt,
            llm: this.model,
        });
        const response = (await chain.call({
            input: arg,
        })).response;
        return `The answer to your question "${arg}" is: ${response}`;
    } 
    name: string = "brainStormOrAskAQuestion";
    description: string = "Useful when you have a question and need an answer. Input must a question directed at yourself. Example: What theme or genre would you like the short story to be?";
}


class NoSaveMemory extends BaseMemory {

    get memoryKeys(): string[] {
        return []
    }
    constructor(private memory: BaseMemory) {
        super();
    }
    async loadMemoryVariables(values: InputValues): Promise<MemoryVariables> {
        const memory = (await this.memory.loadMemoryVariables(values));
        return memory;
    }
    async saveContext(inputValues: InputValues, outputValues: OutputValues): Promise<void> {

    }

}