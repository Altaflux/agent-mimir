import { CreateSessionRequest, CreateSessionResponse, ListSessionsResponse } from "@/lib/contracts";
import { jsonError } from "@/server/runtime/http";
import { sessionManager } from "@/server/runtime/session-manager";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const response: ListSessionsResponse = {
            sessions: sessionManager.listSessions()
        };
        return NextResponse.json(response, {
            headers: {
                "Cache-Control": "no-store"
            }
        });
    } catch (error) {
        return jsonError(error);
    }
}

export async function POST(request: NextRequest) {
    try {
        let payload: CreateSessionRequest = {};
        try {
            payload = (await request.json()) as CreateSessionRequest;
        } catch {
            payload = {};
        }

        const session = await sessionManager.createSession(payload.name);
        const response: CreateSessionResponse = { session };
        return NextResponse.json(response, { status: 201 });
    } catch (error) {
        return jsonError(error);
    }
}
