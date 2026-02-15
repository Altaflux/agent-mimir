import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.join(__dirname, "..");

const agentMimirAliases = {
    "agent-mimir/agent/tool-agent": path.join(repoRoot, "agent-mimir", "dist", "agent-manager", "tool-agent", "index.js"),
    "agent-mimir/agent": path.join(repoRoot, "agent-mimir", "dist", "agent-manager", "index.js"),
    "agent-mimir/communication/multi-agent": path.join(repoRoot, "agent-mimir", "dist", "communication", "multi-agent.js"),
    "agent-mimir/nodejs": path.join(repoRoot, "agent-mimir", "dist", "nodejs", "index.js"),
    "agent-mimir/plugins": path.join(repoRoot, "agent-mimir", "dist", "plugins", "index.js"),
    "agent-mimir/schema": path.join(repoRoot, "agent-mimir", "dist", "schema.js"),
    "agent-mimir/utils/format": path.join(repoRoot, "agent-mimir", "dist", "utils", "format.js")
};

const nextConfig: NextConfig = {
    eslint: {
        ignoreDuringBuilds: true
    },
    outputFileTracingRoot: repoRoot,
    turbopack: {
        resolveAlias: agentMimirAliases
    },
    webpack: (config) => {
        if (Array.isArray(config.resolve?.conditionNames)) {
            config.resolve.conditionNames = config.resolve.conditionNames.filter((name: string) => name !== "development");
        }
        config.resolve = config.resolve || {};
        config.resolve.alias = {
            ...(config.resolve.alias || {}),
            ...agentMimirAliases
        };

        return config;
    }
};

export default nextConfig;
