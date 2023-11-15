import { ImageType, LLMImageHandler } from "../schema.js"

export const openAIImageHandler: LLMImageHandler = (images: ImageType[], detail: "high" | "low" = "high") => {
    return (images ?? []).map((url) => {
        return {
            type: "image_url" as const,
            image_url: {
                url: url.type === "url" ? url.url : `data:image/${url.type};base64,${url.url}`,
                detail: detail
            }
        }
    })
}


export const noopImageHandler: LLMImageHandler = (images: ImageType[], detail: "high" | "low" = "high") => {
    return [];
}
