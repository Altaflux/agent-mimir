import { createFileRoute } from '@tanstack/react-router'
import { proxyRequest } from '../../lib/api-proxy'

export const Route = createFileRoute('/api/$')({
    server: {
        handlers: {
            GET: async ({ request, params }) => proxyRequest(request, params),
            POST: async ({ request, params }) => proxyRequest(request, params),
            PUT: async ({ request, params }) => proxyRequest(request, params),
            PATCH: async ({ request, params }) => proxyRequest(request, params),
            DELETE: async ({ request, params }) => proxyRequest(request, params),
            OPTIONS: async ({ request, params }) => proxyRequest(request, params),
            HEAD: async ({ request, params }) => proxyRequest(request, params),
        },
    },
})
