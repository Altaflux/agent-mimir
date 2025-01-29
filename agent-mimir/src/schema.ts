
export type ImageType = {
    url: string,
    type: SupportedImageTypes
}

export type SupportedImageTypes = "url" | "jpeg" | "png";

export type TextMessageContent = {
    type: "text";
    text: string;
};
export type ImageMessageContent = {
    type: "image_url";
    image_url: {
        url: string;
        type: SupportedImageTypes;
    };
};

export type ComplexMessageContent = TextMessageContent | ImageMessageContent

