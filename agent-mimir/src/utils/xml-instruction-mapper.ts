// import { AttributeDescriptor } from "../plugins/index.js";
// import { ComplexMessageContent, TextMessageContent } from "../schema.js";

// import xml2js from "xml2js";

// function responseHeader(attributeSetters: AttributeDescriptor[]) {
//     const xsdAttributeDefinitions = attributeSetters.map((attributeSetter) => {
//         return `
//               <xs:element type="xs:string" name="${attributeSetter.name}" minOccurs="${attributeSetter.required ? '1' : '0'}" maxOccurs="1">
// 				  <xsd:annotation>
// 					<xsd:documentation xml:lang="en">
//                         Type: ${attributeSetter.attributeType}
// 						Description: ${attributeSetter.description}
// 					</xsd:documentation>
// 				  </xsd:annotation>
// 			  </xs:element>
//         `
//     }).join('\n');

 

//     return `RESPONSE FORMAT INSTRUCTIONS
// ----------------------------

// When responding to me please, ALWAYS respond in the following XML format, the following is the XSD definition of the response format:


// <xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified" xmlns:xs="http://www.w3.org/2001/XMLSchema">
//   <xs:element name="response-output">
//     <xs:complexType>
//       <xs:sequence>
//         <xs:element name="attributes">
//           <xs:complexType>
//             <xs:sequence>
// ${xsdAttributeDefinitions}
//             </xs:sequence>
//           </xs:complexType>
//         </xs:element>
//       </xs:sequence>
//     </xs:complexType>
//   </xs:element>
// </xs:schema>
// MESSAGE TO SEND:
// The message you want to send to the user or agent, the user will only be able to see this message. 


// --------------------`;
// }

// export const USER_RESPONSE = `MESSAGE TO SEND:`;


// const USER_RESPONSE_EXAMPLE_HEADER = `
// ${USER_RESPONSE}
// Hi, I am a helpful assistant, how can I help you?\n

// -----END OF EXAMPLE RESPONSE---------
// `;


// export class ResponseFieldMapper<T = any> {
//     constructor(private readonly attributeSetters: AttributeDescriptor[]) { }

//     createFieldInstructions(additionalExampleInstructions: string = ""): string {

//         const xsdAttributeExamples = this.attributeSetters.map((attributeSetter) => {
//             return `
//                   <${attributeSetter.name}>${attributeSetter.example}</${attributeSetter.name}>
//             `
//         }).join('\n');
//         const exampleAttributes = `<response-output>\n\t<attributes>\n${xsdAttributeExamples}\n\t</attributes>\n</response-output>`;
//         const results = `${responseHeader(this.attributeSetters)}\n\nExample Response:\n--------------------\n${exampleAttributes}\n${USER_RESPONSE_EXAMPLE_HEADER}`
//         return results
//     }

//     async readInstructionsFromResponse(complexResponse: ComplexMessageContent[]): Promise<Record<string, any>> {
//         const parser = new xml2js.Parser({ explicitArray: false, trim: true });

//         const response = complexResponse.filter(c => c.type === "text")
//             .map(t => t as TextMessageContent)
//             .map(t => t.text)
//             .reduce((prev, next) => {
//                 return prev + next;
//             }, "");

//         const result = await parser.parseStringPromise(response);
//         const responseOutput = result['response-output'];
//         if (!responseOutput) {
//             return {}
//         }

//         const attributes = responseOutput.attributes;

//         let attributeValues: Record<string, any> = {};
//         for (const attributeSetter of this.attributeSetters) {
//             const attributeValue = attributes[attributeSetter.name];
//             if (attributeValue) {
//                 attributeValues[attributeSetter.variableName] = attributeValue;
//             }
//         }
//         return attributeValues;
//     }
// }
// //TODO: Support for multiple content types
// export function extractTextResponseFromMessage(complexResponse: ComplexMessageContent[]): ComplexMessageContent[] {
//     const response = complexResponse.filter(c => c.type === "text")
//         .map(t => t as TextMessageContent)
//         .map(t => t.text)
//         .reduce((prev, next) => {
//             return prev + next;
//         }, "");

//     const userMessage = extractImportantText(response, USER_RESPONSE);
//     return [
//         {
//             type: "text",
//             text: userMessage
//         }
//     ]

// }
// function extractImportantText(text: string, cutPoint: string) {
//     const marker = cutPoint;
//     const index = text.indexOf(marker);

//     if (index === -1) {
//         return text;
//     }
//     return text.substring(index + marker.length).trim();
// }
