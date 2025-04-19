import { AttributeDescriptor } from "../plugins/index.js";
import { ComplexMessageContent, TextMessageContent } from "../schema.js";
import xml2js from "xml2js"; // Consider adding @types/xml2js for better type support if not already present

// --- Constants ---
const RESPONSE_OUTPUT_TAG = "response-metadata";
const ATTRIBUTES_TAG = "attributes";
const USER_RESPONSE_MARKER = `MESSAGE TO SEND:`; // Renamed from USER_RESPONSE for clarity
const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";

// --- Type Definitions ---

/**
 * Describes the expected structure of the parsed XML response attributes.
 */
interface ParsedXmlAttributes {
    // Dynamically includes keys based on attributeSetters
    [key: string]: string | undefined;
}

/**
 * Describes the expected structure of the parsed XML response.
 */
interface ParsedXmlResponse {
    [RESPONSE_OUTPUT_TAG]?: {
        [ATTRIBUTES_TAG]?: ParsedXmlAttributes;
    };
}

/**
 * Describes the result of extracting content after a delimiter.
 */
interface ExtractResult {
    tagFound: boolean;
    result: ComplexMessageContent[];
}


// --- Helper Functions ---

/**
 * Generates an XSD <xs:element> string for a given attribute descriptor.
 * @param attributeSetter - The descriptor for the attribute.
 * @returns An XSD element definition string.
 */
function generateXsdElement(attributeSetter: AttributeDescriptor): string {
    // Using template literals with clear indentation
    return `
            <xs:element name="${attributeSetter.name}" type="xs:string" minOccurs="${attributeSetter.required ? '1' : '0'}" maxOccurs="1">
                <xs:annotation>
                    <xs:documentation xml:lang="en">
                        Type: ${attributeSetter.attributeType}
                        Description: ${attributeSetter.description}
                    </xs:documentation>
                </xs:annotation>
            </xs:element>`;
}

/**
 * Generates the main response header XSD schema string.
 * @param additionalExampleInstructions - Any additional instructions to embed.
 * @param attributeSetters - List of attributes to include in the schema.
 * @returns The complete XSD schema and instruction header string.
 */
function generateResponseHeader(additionalExampleInstructions: string, attributeSetters: AttributeDescriptor[]): string {
    const xsdAttributeDefinitions = attributeSetters
        .map(generateXsdElement) // Use the helper function
        .join('\n');

    // Cleaner template literal structure
    return `RESPONSE FORMAT INSTRUCTIONS
----------------------------
When responding to me please, ALWAYS respond in the following XML format.
The following is the XSD definition of the response format:

<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified" xmlns:xs="${XSD_NAMESPACE}">
    <xs:element name="${RESPONSE_OUTPUT_TAG}">
        <xs:complexType>
            <xs:sequence>
                <xs:element name="${ATTRIBUTES_TAG}">
                    <xs:annotation>
                        <xs:documentation xml:lang="en">
                            Elements that provide context for the response (like HTTP headers).
                            These elements are not part of tool calls or code execution; they are declared only within this XML structure.
                        </xs:documentation>
                    </xs:annotation>
                    <xs:complexType>
                        <xs:sequence>
${xsdAttributeDefinitions}
                        </xs:sequence>
                    </xs:complexType>
                </xs:element>
                ${additionalExampleInstructions ? `\n${additionalExampleInstructions}\n\n` : ''}
            </xs:sequence>
        </xs:complexType>
    </xs:element>
</xs:schema>

${USER_RESPONSE_MARKER}
Here goes the message you want to send to the user or agent. The user will only see the content following this "${USER_RESPONSE_MARKER}" marker. Ensure the intended message is outside the XML tags.
--------------------`;
}

/**
 * Extracts the XML content between <response-output> tags.
 * @param textContent - The string potentially containing the XML.
 * @returns The extracted XML string, or null if not found.
 */
function extractResponseOutputXml(textContent: string | null | undefined): string | null {
    if (!textContent) {
        return null;
    }
    // More robust extraction, handling potential attributes in the opening tag
    const openTagStart = `<${RESPONSE_OUTPUT_TAG}`;
    const closeTag = `</${RESPONSE_OUTPUT_TAG}>`;

    const startIndex = textContent.indexOf(openTagStart);
    if (startIndex === -1) {
        return null; // Opening tag start not found
    }

    // Find the end of the opening tag '>' to ensure we capture the whole tag
    const openTagEndIndex = textContent.indexOf('>', startIndex);
     if (openTagEndIndex === -1) {
        return null; // Malformed opening tag
    }

    const endIndex = textContent.indexOf(closeTag, openTagEndIndex);
    if (endIndex === -1) {
        return null; // Closing tag not found
    }

    // Include the closing tag in the result
    const finalEndIndex = endIndex + closeTag.length;

    return textContent.substring(startIndex, finalEndIndex);
}


/**
 * Extracts content from an array of messages appearing *after* a specific delimiter string.
 * It searches within TextMessageContent elements.
 *
 * @param delimiter - The string marker to search for.
 * @param messages - The array of complex messages.
 * @returns An object containing whether the tag was found and the resulting message array.
 */
function extractContentAfterDelimiter(delimiter: string, messages: ComplexMessageContent[]): ExtractResult {
    if (!Array.isArray(messages)) {
        console.error("Input must be an array of ComplexMessageContent.");
        // Return original array wrapped in result structure for consistency? Or empty? Let's return empty.
        return { tagFound: false, result: [] };
    }

    let delimiterFoundAtIndex = -1;
    let delimiterPositionInText = -1;

    // Find the index of the first TextMessageContent containing the delimiter
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.type === "text") {
            const index = message.text.indexOf(delimiter);
            if (index !== -1) {
                delimiterFoundAtIndex = i;
                delimiterPositionInText = index;
                break; // Stop searching once the first occurrence is found
            }
        }
    }

    // If the delimiter was not found
    if (delimiterFoundAtIndex === -1) {
        // If the delimiter isn't found, should we return the original array or nothing?
        // Returning the original implies the *entire* input might be the user message.
        // Let's return the original based on the previous logic's fallback.
        return { tagFound: false, result: messages };
    }

    // --- Delimiter was found ---
    const messageContainingDelimiter = messages[delimiterFoundAtIndex] as TextMessageContent; // Safe cast due to check above

    // Calculate the start index *after* the delimiter within that specific text message
    const startIndexInText = delimiterPositionInText + delimiter.length;

    // Extract the part of the text after the delimiter
    const extractedText = messageContainingDelimiter.text.slice(startIndexInText).trimStart(); // Trim only leading whitespace

    const resultMessages: ComplexMessageContent[] = [];

    // Add the extracted part *if* it's not empty
    if (extractedText.length > 0) {
         resultMessages.push({
            type: "text",
            text: extractedText
        });
    }

    // Add all subsequent elements from the original array
    const remainingElements = messages.slice(delimiterFoundAtIndex + 1);
    resultMessages.push(...remainingElements); // Combine the extracted part with the rest

    return { tagFound: true, result: resultMessages };
}


// --- Main Class ---

/**
 * Maps response fields based on instructions embedded in XML within message content.
 */
export class ResponseFieldMapper<T = any> { // Consider making T more specific if possible
    private readonly xmlParser: xml2js.Parser;

    constructor(private readonly attributeSetters: AttributeDescriptor[]) {
        this.xmlParser = new xml2js.Parser({
            explicitArray: false, // Keeps structure simpler if elements don't repeat unexpectedly
            trim: true,
            // explicitRoot: false // Might simplify accessing 'response-output' directly, but check xml2js docs
        });
    }

    /**
     * Creates the instruction string including XSD and examples.
     * @param additionalExampleInstructions - Optional additional instructions.
     * @returns The complete instruction string.
     */
    public createFieldInstructions(additionalExampleInstructions: string = ""): string {
        const xsdAttributeExamples = this.attributeSetters.map((attr) => {
            // Provide default example if none is given
            const exampleValue = attr.example ?? `[Example ${attr.name}]`;
            return `                <${attr.name}>${exampleValue}</${attr.name}>`; // Indentation improved
        }).join('\n');

        const exampleResponse = `<${RESPONSE_OUTPUT_TAG}>
            <${ATTRIBUTES_TAG}>
${xsdAttributeExamples}
            </${ATTRIBUTES_TAG}>
        </${RESPONSE_OUTPUT_TAG}>`; // Indentation improved

        const userResponseExampleHeader = `
${USER_RESPONSE_MARKER}
Hi, I am a helpful assistant, how can I help you?

-----END OF EXAMPLE RESPONSE---------
`; // Separated for clarity

        const header = generateResponseHeader(additionalExampleInstructions, this.attributeSetters);

        return `${header}\n\nExample Response:\n--------------------\n${exampleResponse}\n${userResponseExampleHeader}`;
    }

    /**
     * Parses the XML from the response content to extract attribute values.
     * @param complexResponse - The array of message content parts.
     * @returns A record containing the extracted attribute values, keyed by their variableName.
     */
    public async readInstructionsFromResponse(complexResponse: ComplexMessageContent[]): Promise<Record<string, any>> {
        // Combine only text parts
        const combinedText = complexResponse
            .filter((c): c is TextMessageContent => c.type === "text")
            .map(t => t.text)
            .join(""); // Join without separators, assuming XML is contiguous

        const xmlToParse = extractResponseOutputXml(combinedText);

        if (!xmlToParse) {
            // console.warn("Could not find or extract response XML block.");
            return {}; // No XML found
        }

        try {
            // Use the defined type for the parsed result
            const result: ParsedXmlResponse = await this.xmlParser.parseStringPromise(xmlToParse);

            // Use optional chaining for safer access
            const attributes = result?.[RESPONSE_OUTPUT_TAG]?.[ATTRIBUTES_TAG];

            if (!attributes) {
                // console.warn("Parsed XML does not contain the expected attributes structure.");
                return {}; // Structure is missing
            }

            const attributeValues: Record<string, any> = {};
            for (const attributeSetter of this.attributeSetters) {
                const attributeValue = attributes[attributeSetter.name]; // Access directly by name

                // Ensure value exists and is non-empty string after trimming
                if (typeof attributeValue === 'string' && attributeValue.trim().length > 0) {
                    attributeValues[attributeSetter.variableName] = attributeValue.trim(); // Store trimmed value
                } else if (attributeSetter.required) {
                    // Handle missing required attributes if necessary (e.g., log warning, throw error)
                     console.warn(`Required attribute "${attributeSetter.name}" missing or empty in response.`);
                }
            }
            return attributeValues;

        } catch (error) {
            console.error("Error parsing response XML:", error instanceof Error ? error.message : error);
            // Consider logging the problematic xmlToParse (carefully, might contain sensitive data)
            // console.error("XML content:", xmlToParse);
            return {}; // Return empty object on parsing error
        }
    }

    /**
     * Extracts the user-intended message content that appears after the USER_RESPONSE_MARKER.
     * @param messages - The array of complex message content.
     * @returns An object indicating if the marker was found and the resulting message content array.
     */
    public getUserMessage(messages: ComplexMessageContent[]): ExtractResult {
        // Directly use the primary marker. The fallback to </response-output> in the original
        // seemed less reliable as it depends on the XML structure itself being the delimiter.
        // If the response *must* contain the marker when a user message is present,
        // searching only for it is cleaner.
        return extractContentAfterDelimiter(USER_RESPONSE_MARKER, messages);
    }
}

