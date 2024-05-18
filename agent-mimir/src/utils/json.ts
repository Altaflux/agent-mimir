
import { jsonrepair } from 'jsonrepair'

export function callJsonRepair(input: string) {
    const cleanedInput =input.substring(0, input.lastIndexOf('}') + 1);
    return (jsonrepair(cleanedInput));
}

export async function simpleParseJson(input: string) {

    const jsonStartMarker = '```json';
    const jsonStartMarkerAlt = '```';
    const jsonStartIndex = input.indexOf(jsonStartMarker) !== -1
        ? input.indexOf(jsonStartMarker) + jsonStartMarker.length
        : input.indexOf(jsonStartMarkerAlt) !== -1
            ? input.indexOf(jsonStartMarkerAlt) + jsonStartMarkerAlt.length
            : -1;


    let jsonString = removeTextAfterLastBacktick(input);

    if (jsonStartIndex !== -1) {
        jsonString = jsonString.substring(jsonStartIndex).trim();
    }
    if (jsonString.endsWith("```")) {
        jsonString = jsonString.slice(0, -3).trimEnd();
    }
    const jsonrepairOut = callJsonRepair(jsonString)
    const response = JSON.parse(jsonrepairOut);
    return response;
}

function removeTextAfterLastBacktick(str: string) {
    const lastIndex = str.lastIndexOf('```');

    if (lastIndex === -1) {
        return str;
    }

    return str.substring(0, lastIndex + 3);
}

