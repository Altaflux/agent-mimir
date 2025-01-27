
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
