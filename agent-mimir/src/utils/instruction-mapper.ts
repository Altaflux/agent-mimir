import { AttributeDescriptor } from "../plugins/index.js";
import { ComplexMessageContent, TextMessageContent } from "../schema.js";

const responseHeader = `RESPONSE FORMAT INSTRUCTIONS
----------------------------

When responding to me please, please output a response in the following format:
--------------------`;

const USER_RESPONSE_HEADER = `
RESPONSE TO USER:
The message to the user...\n`;

const USER_RESPONSE_EXAMPLE_HEADER = `
RESPONSE TO USER:
Hi, I am a helpful assistant, how can I help you?\n`;



const USER_RESPONSE = `RESPONSE TO USER:`;

export class ResponseFieldMapper<T = any> {
    constructor(private readonly attributeSetters: AttributeDescriptor[]) { }

    createFieldInstructions(): string {
        const fields = this.attributeSetters.map((attributeSetter) => {
            return `- ${attributeSetter.name}: (Type: ${attributeSetter.attributeType} ) \\ ${attributeSetter.description}`
        }).join('\n');

        const examples = this.attributeSetters
            .filter((attributeSetter) => attributeSetter.example)
            .map((attributeSetter) => {
                return `- ${attributeSetter.name}: ${attributeSetter.example}`
            }).join('\n');

        const results = `${responseHeader}\n${fields}\n\n${USER_RESPONSE_HEADER}\n\nExample Response:\n--------------------\n${examples}\n${USER_RESPONSE_EXAMPLE_HEADER}`;
        return results
    }

    async readInstructionsFromResponse(complexResponse: ComplexMessageContent[]): Promise<Record<string, any>> {

        const response = complexResponse.filter(c => c.type === "text")
            .map(t => t as TextMessageContent)
            .map(t => t.text)
            .reduce((prev, next) => {
                return prev + next;
            }, "");

        const responseParts = this.attributeSetters.map((attributeSetter) => `- ${attributeSetter.name}`).join('|');
        const mappings = this.attributeSetters.map((attributeSetter) => {
            return {
                regex: new RegExp(`(?<=- ${attributeSetter.name}:\\s)([\\s\\S]*?)` + '(?=\\s' + responseParts + `|\\n|${USER_RESPONSE}$)`),
                variableName: attributeSetter.variableName,
            }
        });

        const res = mappings.reduce((acc, d) => {
            return {
                ...acc,
                [d.variableName]: d.regex.exec(response)?.[0]?.trim()
            }
        }, {});
        return res;
    }
}
//TODO: Support for multiple content types
export function extractTextResponseFromMessage(complexResponse: ComplexMessageContent[]): ComplexMessageContent[] {
    const response = complexResponse.filter(c => c.type === "text")
        .map(t => t as TextMessageContent)
        .map(t => t.text)
        .reduce((prev, next) => {
            return prev + next;
        }, "");

        const userMessage = extractImportantText(response, USER_RESPONSE);
        return [
            {
                type: "text",
                text: userMessage
            }
        ]

}
function extractImportantText(text: string, cutPoint: string) {
    const marker = cutPoint;
    const index = text.indexOf(marker);

    if (index === -1) {
        return text;
    }
    return text.substring(index + marker.length).trim();
}
