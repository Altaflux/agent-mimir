const responseHeader = `RESPONSE FORMAT INSTRUCTIONS
----------------------------

When responding to me please, please output a response in the following format:
--------------------`;

export type AttributeDescriptor = {
    name: string,
    variableName: string,
    description: string,
    example?: string,
}


export class ResponseFieldMapper<T = any> {
    constructor(private readonly attributeSetters: AttributeDescriptor[]) { }

    createFieldInstructions(): string {
        const fields = this.attributeSetters.map((attributeSetter) => {
            return `-${attributeSetter.name}: ${attributeSetter.description}`
        }).join('\n');

        const examples = this.attributeSetters
            .filter((attributeSetter) => attributeSetter.example)
            .map((attributeSetter) => {
                return `-${attributeSetter.name}: ${attributeSetter.example}`
            }).join('\n');

        const results = `${responseHeader}\n${fields}\n\nExample Response:\n--------------------\n${examples}`;
        return results
    }

    async readInstructionsFromResponse(response: string): Promise<T> {
        const responseParts = this.attributeSetters.map((attributeSetter) => `-${attributeSetter.name}`).join('|');
        const mappings = this.attributeSetters.map((attributeSetter) => {
            return {
                regex: new RegExp(`(?<=-${attributeSetter.name}:\\s)([\\s\\S]*?)` + '(?=\\s' + responseParts + "|$)"),
                variableName: attributeSetter.variableName,
            }
        });

        return mappings.reduce((acc, d) => {
            return {
                ...acc,
                [d.variableName]: d.regex.exec(response)?.[0]?.trim()
            }
        }, {}) as T;

    }
}