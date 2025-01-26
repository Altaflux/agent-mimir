import { AgentTool } from "./tools/index.js";
import { StateAnnotation } from "./agent-manager/agent.js";
import {  AgentMessage, AgentWorkspace } from "./agent-manager/index.js";



////////////////
export type ImageType = {
    url: string,
    type: SupportedImageTypes
}

export type SupportedImageTypes = "url" | "jpeg" | "png";

export type ResponseContentText = {
    type: "text";
    text: string;
};
export type ResponseContentImage = {
    type: "image_url";
    image_url: {
        url: string;
        type: SupportedImageTypes;
    };
};

export type ComplexResponse = ResponseContentText | ResponseContentImage


////////////////
export const FILES_TO_SEND_FIELD = "filesToSend";
