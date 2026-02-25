
export type TextMessageContent = {
    type: "text";
    text: string;
};
export type ImageMessageContent = {
    type: "image";
    mimeType?: string;
    data?: string;
};

export type ComplexMessageContent = TextMessageContent | ImageMessageContent

