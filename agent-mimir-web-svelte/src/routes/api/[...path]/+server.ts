import type { RequestHandler } from "@sveltejs/kit";

function normalizePathPrefix(value: string): string {
    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
        return withLeadingSlash.slice(0, -1);
    }

    return withLeadingSlash;
}

function toPathSegments(pathValue: string | undefined): string[] {
    if (!pathValue) {
        return [];
    }

    return pathValue.split("/").filter((segment) => segment.length > 0);
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

const handler: RequestHandler = async ({ params, request }) => {
    try {
        const pathSegments = toPathSegments(params.path);
        const upstreamUrl = buildUpstreamUrl(request.url, pathSegments);
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
        return new Response(
            JSON.stringify({
                error: {
                    code: "UPSTREAM_UNAVAILABLE",
                    message: "Failed to reach the API service."
                }
            }),
            {
                status: 502,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
