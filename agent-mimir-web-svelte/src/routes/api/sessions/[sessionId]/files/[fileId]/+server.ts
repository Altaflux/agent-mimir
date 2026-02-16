import { readFile } from "fs/promises";
import path from "path";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError } from "@/lib/server/http";

function inferMimeType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    switch (extension) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".gif":
            return "image/gif";
        case ".pdf":
            return "application/pdf";
        case ".md":
            return "text/markdown";
        case ".txt":
            return "text/plain";
        case ".json":
            return "application/json";
        default:
            return "application/octet-stream";
    }
}

export const GET = async ({ params }: { params: { sessionId: string; fileId: string } }) => {
    try {
        const file = await sessionManager.resolveFile(params.sessionId, params.fileId);
        const bytes = await readFile(file.absolutePath);

        return new Response(bytes, {
            headers: {
                "Content-Type": inferMimeType(file.fileName),
                "Content-Disposition": `attachment; filename=\"${file.fileName}\"`
            }
        });
    } catch (error) {
        return jsonError(error);
    }
};
