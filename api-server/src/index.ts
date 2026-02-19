import { createApiServer } from "./server.js";

function parsePort(value: string | undefined): number {
    if (!value) {
        return 8787;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid MIMIR_API_PORT value: ${value}`);
    }

    return parsed;
}

async function main() {
    const host = process.env.MIMIR_API_HOST ?? "0.0.0.0";
    const port = parsePort(process.env.MIMIR_API_PORT);

    const app = await createApiServer();

    const shutdown = async (signal: NodeJS.Signals) => {
        app.log.info({ signal }, "Shutting down API server.");
        await app.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await app.listen({ host, port });
    app.log.info({ host, port }, "Agent Mimir API server started.");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
