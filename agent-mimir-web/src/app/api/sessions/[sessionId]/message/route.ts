import { SendMessageResponse } from "@/lib/contracts";
import { HttpError } from "@/server/runtime/errors";
import { jsonError } from "@/server/runtime/http";
import { SendMessageInput, sessionManager, UploadInput } from "@/server/runtime/session-manager";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isFile(value: FormDataEntryValue): value is File {
    return typeof value !== "string";
}

async function toUpload(file: File): Promise<UploadInput> {
    return {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        bytes: Buffer.from(await file.arrayBuffer())
    };
}

export async function POST(
    request: NextRequest,
    context: {
        params: Promise<{ sessionId: string }>;
    }
) {
    try {
        const { sessionId } = await context.params;
        const formData = await request.formData();

        const message = formData.get("message");
        const text = typeof message === "string" ? message : "";

        const workspaceFileEntries = formData.getAll("workspaceFiles").filter(isFile);
        const chatImageEntries = formData.getAll("chatImages").filter(isFile);

        if (workspaceFileEntries.length + chatImageEntries.length > 10) {
            throw new HttpError(400, "TOO_MANY_FILES", "Maximum 10 files per message.");
        }

        const payload: SendMessageInput = {
            text,
            workspaceFiles: await Promise.all(workspaceFileEntries.map((entry: File) => toUpload(entry))),
            chatImages: await Promise.all(chatImageEntries.map((entry: File) => toUpload(entry)))
        };

        const session = await sessionManager.sendMessage(sessionId, payload);
        const response: SendMessageResponse = { session };
        return NextResponse.json(response);
    } catch (error) {
        return jsonError(error);
    }
}
