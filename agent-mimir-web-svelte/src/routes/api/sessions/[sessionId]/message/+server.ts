import { json } from "@sveltejs/kit";
import type { SendMessageResponse } from "@/lib/contracts";
import { HttpError } from "agent-mimir-runtime-shared/runtime/errors";
import type { SendMessageInput, UploadInput } from "agent-mimir-runtime-shared/runtime/session-manager";
import { sessionManager } from "agent-mimir-runtime-shared/runtime/session-manager";
import { jsonError } from "@/lib/server/http";

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

export const POST = async ({ params, request }: { params: { sessionId: string }; request: Request }) => {
    try {
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

        const session = await sessionManager.sendMessage(params.sessionId, payload);
        const response: SendMessageResponse = { session };
        return json(response);
    } catch (error) {
        return jsonError(error);
    }
};
