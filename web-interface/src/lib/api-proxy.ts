type RouteParams = {
    _splat?: string;
};

function normalizePathPrefix(value: string): string {
    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
        return withLeadingSlash.slice(0, -1);
    }

    return withLeadingSlash;
}

function buildUpstreamUrl(requestUrl: string, splatPath: string | undefined): string {
    const baseUrl = (process.env.MIMIR_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
    const prefix = normalizePathPrefix(process.env.MIMIR_API_PREFIX ?? "/v1");
    const request = new URL(requestUrl);

    let suffix = "";
    if (splatPath && splatPath.length > 0) {
        // Splat path might be like `sessions/123/stream`
        // Encode each segment, but preserve slashes
        const joinedPath = splatPath.split("/").map(segment => encodeURIComponent(segment)).join("/");
        suffix = `/${joinedPath}`;
    }

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

export async function proxyRequest(request: Request, params: RouteParams): Promise<Response> {
    try {
        const splat = params._splat;
        const upstreamUrl = buildUpstreamUrl(request.url, splat);
        const method = request.method.toUpperCase();

        const init: RequestInit & { duplex?: "half" } = {
            method,
            headers: buildProxyHeaders(request),
            redirect: "manual",
            signal: request.signal
        };

        if (method !== "GET" && method !== "HEAD" && request.body) {
            init.body = request.body;
            init.duplex = "half";
        }

        const upstream = await fetch(upstreamUrl, init);
        return upstream;
    } catch (e) {
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
}
