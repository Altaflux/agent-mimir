import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ path?: string[] }>;
};

function normalizePathPrefix(value: string): string {
    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
        return withLeadingSlash.slice(0, -1);
    }

    return withLeadingSlash;
}

function buildUpstreamUrl(requestUrl: string, pathSegments: string[]): string {
    const baseUrl = (process.env.MIMIR_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
    const prefix = normalizePathPrefix(process.env.MIMIR_API_PREFIX ?? "/v1");
    const request = new URL(requestUrl);
    const joinedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
    const suffix = joinedPath.length > 0 ? `/${joinedPath}` : "";
    return `${baseUrl}${prefix}${suffix}${request.search}`;
}

function buildProxyHeaders(request: Request): Headers {
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("connection");

    const serviceToken = process.env.MIMIR_API_SERVICE_TOKEN;
    if (serviceToken && serviceToken.length > 0) {
        headers.set("x-mimir-service-token", serviceToken);
    }

    return headers;
}

async function proxyRequest(request: NextRequest, context: RouteContext): Promise<Response> {
    try {
        const { path = [] } = await context.params;
        const upstreamUrl = buildUpstreamUrl(request.url, path);
        const method = request.method.toUpperCase();

        const init: RequestInit & { duplex?: "half" } = {
            method,
            headers: buildProxyHeaders(request),
            redirect: "manual"
        };

        if (method !== "GET" && method !== "HEAD" && request.body) {
            init.body = request.body;
            init.duplex = "half";
        }

        const upstream = await fetch(upstreamUrl, init);
        return upstream;
    } catch {
        return NextResponse.json(
            {
                error: {
                    code: "UPSTREAM_UNAVAILABLE",
                    message: "Failed to reach the API service."
                }
            },
            { status: 502 }
        );
    }
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
    return await proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
    return await proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
    return await proxyRequest(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
    return await proxyRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
    return await proxyRequest(request, context);
}

export async function OPTIONS(request: NextRequest, context: RouteContext): Promise<Response> {
    return await proxyRequest(request, context);
}

export async function HEAD(request: NextRequest, context: RouteContext): Promise<Response> {
    return await proxyRequest(request, context);
}
