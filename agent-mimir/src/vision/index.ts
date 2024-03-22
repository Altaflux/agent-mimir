import { ImageType, LLMImageHandler } from "../schema.js"

export const openAIImageHandler: LLMImageHandler = (image: ImageType, detail: "high" | "low" = "high") => {
    return {
        type: "image_url" as const,
        image_url: {
            url: image.type === "url" ? image.url : `data:image/${image.type};base64,${image.url}`,
            detail: detail
        }
    }
}


export const noopImageHandler: LLMImageHandler = (images: ImageType, detail: "high" | "low" = "high") => {
    throw new Error("Images not supported")
}
