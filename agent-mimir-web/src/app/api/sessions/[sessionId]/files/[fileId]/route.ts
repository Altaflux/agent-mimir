import { jsonError } from "@/server/runtime/http";
import { sessionManager } from "@/server/runtime/session-manager";
import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(
    _request: Request,
    context: {
        params: Promise<{ sessionId: string; fileId: string }>;
    }
) {
    try {
        const { sessionId, fileId } = await context.params;
        const file = await sessionManager.resolveFile(sessionId, fileId);
        const bytes = await fs.readFile(file.absolutePath);

        return new NextResponse(bytes, {
            headers: {
                "Content-Type": inferMimeType(file.fileName),
                "Content-Disposition": `attachment; filename=\"${file.fileName}\"`
            }
        });
    } catch (error) {
        return jsonError(error);
    }
}
