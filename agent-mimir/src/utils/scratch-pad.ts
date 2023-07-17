
import pkg from 'ring-buffer-ts';
import { MimirAgentPlugin } from '../index.js';
import { AttributeDescriptor, ResponseFieldMapper } from '../agent/instruction-mapper.js';
import { MessagesPlaceholder, SystemMessagePromptTemplate } from 'langchain/prompts';
import { MimirAIMessage } from '../agent/base-agent.js';
const { RingBuffer } = pkg;

export class ScratchPadManager {

    private scratchPad: any;
 
    constructor(size: number) {
        this.scratchPad = new RingBuffer(size);
    }

    async clear() {
        this.scratchPad.clear();
    }

    async storeMessage( value: string) {
        this.scratchPad.add({ value });
    }

    async buildScratchPadList(): Promise<string> {
        return this.scratchPad.toArray()
            .map((helper: any, i: number) => `${helper.value}`)
            .join("\n") ?? "";
    }
}


export class ScratchPadPlugin extends MimirAgentPlugin {
    private scratchPadManager: ScratchPadManager;
    
    constructor(scratchPadManager: ScratchPadManager) {
        super();
        this.scratchPadManager = scratchPadManager;
    }

    attributes(): AttributeDescriptor[] {
        return [
            {
                name: "Save To ScratchPad",
                description: "\\ Any important piece of information you may be able to use later. This field is optional. ",
                variableName: "saveToScratchPad",
                example: "The plot of the story is about a young kid going on an adventure to find his lost dog."
            },
        ];
    }

    async readResponse(aiMessage: MimirAIMessage, responseFieldMapper: ResponseFieldMapper<any>): Promise<void> {
        const message = await responseFieldMapper.readInstructionsFromResponse(aiMessage.text ?? "");
        if (message.saveToScratchPad && message.saveToScratchPad.length > 1) {
            await this.scratchPadManager.storeMessage(message.saveToScratchPad);
        }
    }
    systemMessages(): (SystemMessagePromptTemplate | MessagesPlaceholder)[] {
        return [
            SystemMessagePromptTemplate.fromTemplate(`You have the following items in your scratchpad:\n{scratchpad_items}\n`),
        ];
    }

    async getInputs(): Promise<Record<string, any>> {
        return {
            "scratchpad_items": await this.scratchPadManager.buildScratchPadList()
        };
    }

    async clear(): Promise<void> {
        await this.scratchPadManager.clear();
    }
}