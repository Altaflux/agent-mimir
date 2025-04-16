import { AttributeDescriptor } from "../plugins/index.js";
import { ComplexMessageContent, TextMessageContent } from "../schema.js";

import xml2js from "xml2js";

function responseHeader(additionalExampleInstructions: string, attributeSetters: AttributeDescriptor[]) {
    const xsdAttributeDefinitions = attributeSetters.map((attributeSetter) => {
        return `
              <xs:element type="xs:string" name="${attributeSetter.name}" minOccurs="${attributeSetter.required ? '1' : '0'}" maxOccurs="1">
                  <xsd:annotation>
                    <xsd:documentation xml:lang="en">
                        Type: ${attributeSetter.attributeType}
                        Description: ${attributeSetter.description}
                    </xsd:documentation>
                  </xsd:annotation>
              </xs:element>
        `
    }).join('\n');



    return `RESPONSE FORMAT INSTRUCTIONS
----------------------------

When responding to me please, ALWAYS respond in the following XML format, the following is the XSD definition of the response format:


<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="response-output">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="attributes">
            <xsd:annotation>
                <xsd:documentation xml:lang="en">
                    Elements that help get context of the response, think of them as http headers that add additional context to the response.
                    This elements are not part of tool calls or code executiion, they can only be declared in this XML.
                </xsd:documentation>
            </xsd:annotation>
          <xs:complexType>
            <xs:sequence>
${xsdAttributeDefinitions}
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
${additionalExampleInstructions}
    </xs:complexType>
  </xs:element>
</xs:schema>
MESSAGE TO SEND:
Here goes the message you want to send to the user or agent, the user will only be able to see this message and not whatever is inside the XML so be sure that the message you want to send is outside the XML tags.


--------------------`;
}

export const USER_RESPONSE = `MESSAGE TO SEND:`;


const USER_RESPONSE_EXAMPLE_HEADER = `
${USER_RESPONSE}
Hi, I am a helpful assistant, how can I help you?\n

-----END OF EXAMPLE RESPONSE---------
`;


export class ResponseFieldMapper<T = any> {
    constructor(private readonly attributeSetters: AttributeDescriptor[]) { }

    createFieldInstructions(additionalExampleInstructions: string = ""): string {
        const xsdAttributeExamples = this.attributeSetters.map((attributeSetter) => {
            return `
                  <${attributeSetter.name}>${attributeSetter.example}</${attributeSetter.name}>
            `
        }).join('\n');
        const exampleAttributes = `<response-output>\n\t<attributes>\n${xsdAttributeExamples ? xsdAttributeExamples : ''}\n\t</attributes>\n</response-output>`;
        const results = `${responseHeader(additionalExampleInstructions, this.attributeSetters)}\n\nExample Response:\n--------------------\n${exampleAttributes}\n${USER_RESPONSE_EXAMPLE_HEADER}`
        return results
    }

    async readInstructionsFromResponse(complexResponse: ComplexMessageContent[]): Promise<Record<string, any>> {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const response = complexResponse.filter(c => c.type === "text")
            .map(t => t as TextMessageContent)
            .map(t => t.text)
            .reduce((prev, next) => {
                return prev + next;
            }, "");

        try {
            const result = await parser.parseStringPromise(getExecutionCodeContentRegex(response) ?? "<response-output></response-output>");
            const responseOutputAttributes = result['attributes'];
            if (!responseOutputAttributes) {
                return {}
            }

            let attributeValues: Record<string, any> = {};
            for (const attributeSetter of this.attributeSetters) {
                const attributeValue = responseOutputAttributes[attributeSetter.name];
                if (attributeValue && attributeValue.trim().length > 0) {
                    attributeValues[attributeSetter.variableName] = attributeValue;
                }
            }
            return attributeValues;
        } catch (error) {
            console.error("Error parsing XML:", error);
        }
        return {}
    }


     getUserMessage(inputArray: ComplexMessageContent[]): { tagFound: boolean, result: ComplexMessageContent[] } {
        // Validate input: Ensure it's an array
        if (!Array.isArray(inputArray)) {
          console.error("Input must be an array.");
          return { tagFound: false, result: [] }; // Return empty array for invalid input
        }
      
        const marker = USER_RESPONSE; // Note: Using the exact marker from your example
        let markerFoundAtIndex = -1;
        let result: ComplexMessageContent[] = [];
      
        // Find the index of the first element containing the marker
        for (let i = 0; i < inputArray.length; i++) {
          const entry = inputArray[i];
          // Make sure the element is a string before calling indexOf
          if (entry.type === "text" && entry.text.includes(marker)) {
            markerFoundAtIndex = i;
            break; // Stop searching once the first occurrence is found
          }
        }
      
        // If the marker was not found in any element
        if (markerFoundAtIndex === -1) {
          return { tagFound: false, result: inputArray }; // Return the original array if marker not found
        }
      
        // --- Marker was found ---
      
        // Get the string where the marker was found
        const stringContainingMarker = (inputArray[markerFoundAtIndex] as TextMessageContent);
      
        // Find the position *within* that string where the marker ends
        const markerIndexInString = (stringContainingMarker as TextMessageContent).text.indexOf(marker);
        const startIndex = markerIndexInString + marker.length;
      
        // Extract the part of the string after the marker
        // Use trim() to remove leading/trailing whitespace
        const extractedPart = {
          type: "text" as const,
          text: stringContainingMarker.text.slice(startIndex).trim()
        };
      
        // Add the extracted part as the first element of the result
        result.push(extractedPart);
      
        // Add all subsequent elements from the original array (if any)
        // Slice the original array starting from the index *after* the one where the marker was found
        const remainingElements = inputArray.slice(markerFoundAtIndex + 1);
        result = result.concat(remainingElements); // Combine the extracted part with the rest
      
        /* Alternative using spread syntax:
        const remainingElements = inputArray.slice(markerFoundAtIndex + 1);
        result = [extractedPart, ...remainingElements];
        */
      
        return { tagFound: true, result: result }; // Return the result array with the extracted part
      }
      
      
    
}


export function getExecutionCodeContentRegex(xmlString: string): string | null {
    if (typeof xmlString !== 'string') {
        console.error("Input must be a string.");
        return null;
    }

    // Regex explanation:
    // <execution-code> : Matches the literal opening tag.
    // (          : Start capturing group 1 (this is what we want to extract).
    //   .*?      : Matches any character (.), zero or more times (*), non-greedily (?).
    //              Non-greedy is important to stop at the *first* closing tag.
    // )          : End capturing group 1.
    // <\/execution-code> : Matches the literal closing tag (the '/' needs escaping).
    // s          : Flag to make '.' match newline characters as well (dotall).
    const regex = /<response-output>(.*?)<\/response-output>/s;

    const match = xmlString.match(regex);

    // If a match is found, match will be an array.
    // match[0] is the full matched string (e.g., "<execution-code>content</execution-code>")
    // match[1] is the content of the first capturing group (e.g., "content")
    if (match && match[1] !== undefined) {
        return match[1]; // Return the captured content
    } else {
        return null; // Tag not found or content is missing somehow
    }
}