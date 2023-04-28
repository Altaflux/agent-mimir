
import pkg from 'ring-buffer-ts';
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
